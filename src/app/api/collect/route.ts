import { eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { readTextCapped } from "@/core/net/read";
import { db, dbReady, schema } from "@/db/client";
import { currentSettings } from "@/core/settings";
import { describeError, log } from "@/server/log";
import { clientAddress, takeToken } from "@/server/rate-limit";

export const runtime = "nodejs";

/**
 * Ingest for public/g.js. This is the one route in the app that is meant to
 * be called from a browser on someone else's domain, so it needs CORS — and
 * it needs to accept whatever the browser actually sent. The snippet posts
 * `text/plain` on purpose (see g.js) so the request stays CORS-simple and
 * skips a preflight; that means the body has to be read as text and parsed
 * as JSON here regardless of the declared content type.
 *
 * It is also the one route with no authentication and no way to have any: the
 * product id is public by construction, printed in a <script> tag on the
 * customer's own site. A signed token would have to ship in that same snippet,
 * so it would protect nothing. What actually raises the cost of poisoning this
 * data is here instead: an origin check against the product's own registered
 * URL, two rate-limit buckets, and hard input bounds.
 */

const ALLOW_METHODS = "POST, OPTIONS";
const ALLOW_HEADERS = "Content-Type";

/** A single script tag can be pasted onto any page on the product's site. */
const MAX_BODY_BYTES = 8 * 1024;

/** One browser sends a handful of events per visit; a script sends thousands. */
const PER_CLIENT: { capacity: number; refillPerSec: number } = { capacity: 120, refillPerSec: 1 };
/** The backstop that address rotation cannot get around — bounds disk growth. */
const PER_PRODUCT: { capacity: number; refillPerSec: number } = { capacity: 2_000, refillPerSec: 0.5 };

const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;

const CollectInputSchema = z.object({
  // Ids are crypto.randomUUID(), so this is exact and turns most junk traffic
  // away before it reaches SQLite.
  productId: z.uuid(),
  anonId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  path: z.string().max(2000).nullish(),
  referrer: z.string().max(2000).nullish(),
  // A closed object rather than a record: an 8 KB body could otherwise carry
  // thousands of arbitrary keys straight into a JSON column, and the funnel
  // only ever reads utm_source anyway.
  utm: z
    .object(Object.fromEntries(UTM_KEYS.map((k) => [k, z.string().max(200)])) as {
      [K in (typeof UTM_KEYS)[number]]: z.ZodString;
    })
    .partial()
    .optional()
    .default({}),
  // Everything else (e.g. `props`, `ts`) is accepted on the wire and dropped:
  // the events table only has a place for what the funnel actually reads.
  // `ts` in particular is not trusted from the client — see below.
});

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    // Echoes the specific origin once it is known to be the product's own, and
    // falls back to "*" only for the preflight, which carries no data.
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": ALLOW_METHODS,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    Vary: "Origin",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders(null) });
}

export async function POST(request: Request) {
  await dbReady;

  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin);
  const reject = (status: number, error: string, extra: Record<string, string> = {}) =>
    NextResponse.json({ error }, { status, headers: { ...cors, ...extra } });

  // Read with a byte ceiling rather than trusting content-length: a chunked
  // POST omits that header entirely, which the previous check read as zero.
  const { text: raw, truncated } = await readTextCapped(request, MAX_BODY_BYTES);
  if (truncated) return reject(413, "payload too large");

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reject(400, "invalid JSON");
  }

  const parsed = CollectInputSchema.safeParse(body);
  if (!parsed.success) return reject(400, parsed.error.issues[0]?.message ?? "invalid event");
  const input = parsed.data;

  const client = takeToken(`collect:${input.productId}:${clientAddress(request)}`, PER_CLIENT);
  if (!client.ok) return reject(429, "too many events", { "Retry-After": String(client.retryAfterSec) });

  const product = takeToken(`collect:${input.productId}`, PER_PRODUCT);
  if (!product.ok) {
    return reject(429, "too many events", { "Retry-After": String(product.retryAfterSec) });
  }

  const registered = await registeredHost(input.productId);
  if (!registered) return reject(404, "unknown product");
  if (!originMatches(origin ?? request.headers.get("referer"), registered)) {
    log.warn("collect.foreign_origin", { productId: input.productId, origin, expected: registered });
    return reject(403, "this product does not accept events from that origin");
  }

  try {
    await db.insert(schema.events).values({
      productId: input.productId,
      anonId: input.anonId,
      sessionId: input.sessionId,
      name: input.name,
      path: input.path ?? null,
      referrer: input.referrer ?? null,
      utm: input.utm,
      // Server time, not the client's clock: this timestamp drives the
      // retention window and session bucketing, and a browser clock is not
      // something to trust for either.
      ts: new Date(),
    });
  } catch (error) {
    // Not routed through the shared wrapper: this endpoint answers browsers on
    // other origins, so every response — including failures — needs its own
    // CORS headers, and the success case is a bodyless 204.
    log.error("collect.insert_failed", { productId: input.productId, ...describeError(error) });
    return reject(500, "could not record the event");
  }

  schedulePrune();

  return new NextResponse(null, { status: 204, headers: cors });
}

/**
 * This route deliberately has no ownership check, and must not grow one.
 *
 * It is unauthenticated by construction: the product id sits in a <script> tag
 * on a public website, and the visitors it records have no account here. There
 * is no session to check an owner against.
 *
 * Its tenancy check is the pair below instead — an event is accepted only when
 * its Origin is the hostname the product was registered with. That is the same
 * question assertProductOwner asks, answered with the only credential a
 * browser on someone else's site can offer. The route reads nothing and writes
 * only events belonging to that one product.
 *
 * Cached because this runs on every pageview of the customer's site and the
 * answer changes only when they register a product.
 */
const HOST_CACHE_MS = 60_000;
const hostCache = new Map<string, { host: string | null; at: number }>();

async function registeredHost(productId: string): Promise<string | null> {
  const cached = hostCache.get(productId);
  if (cached && Date.now() - cached.at < HOST_CACHE_MS) return cached.host;

  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, productId),
    columns: { url: true },
  });
  const host = product ? new URL(product.url).hostname.toLowerCase() : null;
  hostCache.set(productId, { host, at: Date.now() });
  return host;
}

/** A subdomain of the registered site counts: docs.example.com is still theirs. */
function originMatches(origin: string | null, registeredHost: string): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === registeredHost || host.endsWith(`.${registeredHost}`);
}

/**
 * Pruning old events without a scheduler: roughly one request in a thousand
 * pays for it, and it is not awaited so it never delays the 204.
 */
let pruning = false;

function schedulePrune(): void {
  if (pruning || Math.random() >= 0.001) return;
  pruning = true;
  const cutoff = new Date(
    Date.now() - currentSettings().GRAPE_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  void db
    .delete(schema.events)
    .where(lt(schema.events.ts, cutoff))
    .then(() => log.info("events.pruned", { before: cutoff.toISOString() }))
    .catch((error: unknown) => log.warn("events.prune_failed", { error: String(error) }))
    .finally(() => {
      pruning = false;
    });
}
