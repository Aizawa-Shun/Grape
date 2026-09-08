import { NextResponse } from "next/server";
import { z } from "zod";

import { db, schema } from "@/db/client";

export const runtime = "nodejs";

/**
 * Ingest for public/g.js. This is the one route in the app that is meant to
 * be called from a browser on someone else's domain, so it needs CORS — and
 * it needs to accept whatever the browser actually sent. The snippet posts
 * `text/plain` on purpose (see g.js) so the request stays CORS-simple and
 * skips a preflight; that means the body has to be read as text and parsed
 * as JSON here regardless of the declared content type.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** A single script tag can be pasted onto any page on the product's site. */
const MAX_BODY_BYTES = 8 * 1024;

const CollectInputSchema = z.object({
  productId: z.string().min(1),
  anonId: z.string().min(1).max(200),
  sessionId: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  path: z.string().max(2000).nullish(),
  referrer: z.string().max(2000).nullish(),
  utm: z.record(z.string(), z.string()).optional().default({}),
  // Everything else (e.g. `props`, `ts`) is accepted on the wire and dropped:
  // the events table only has a place for what the funnel actually reads.
  // `ts` in particular is not trusted from the client — see below.
});

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413, headers: CORS_HEADERS });
  }

  const raw = await request.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers: CORS_HEADERS });
  }

  const parsed = CollectInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "invalid event" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const input = parsed.data;

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
    // The FK on events.product_id is the only thing that can realistically
    // fail here (a snippet pasted with a stale or copy-pasted-wrong id), and
    // it is the caller's problem, not ours — a 500 would be misleading.
    return NextResponse.json(
      { error: `unknown product: ${describe(error)}` },
      { status: 404, headers: CORS_HEADERS },
    );
  }

  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  // Drizzle wraps the driver error as "Failed query: <sql>" and puts the
  // actual reason (e.g. FOREIGN KEY constraint failed) on `.cause` — that
  // is the part worth telling the caller.
  const cause = error.cause;
  if (cause instanceof Error) return cause.message.split("\n")[0];
  return error.message.split("\n")[0];
}
