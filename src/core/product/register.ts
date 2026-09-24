import { eq } from "drizzle-orm";

import type { SaasAnalysis } from "@/core/context/analysis";
import { analyzeSaas } from "@/core/context/analyze";
import { crawlSite } from "@/core/context/crawl";
import { contextFromAnalysis } from "@/core/context/derive";
import { AppError, toAppError } from "@/core/errors";
import {
  extractProductContext,
  siteNameFrom,
  type ProductContextExtraction,
} from "@/core/context/extract";
import { getProvider, llmAvailable } from "@/core/llm";
import { db, schema } from "@/db/client";
import { normalizeUrl } from "@/core/context/crawl";
import { describeError, log } from "@/server/log";
import { describeForUser } from "@/server/http/errors";

/**
 * ① PRODUCT: turns a bare URL into a registered product with an initial
 * Product Context (version 1).
 *
 * Split in two, because the two halves have very different durations. Creating
 * the row is a single insert; reading the site is five page fetches, sometimes
 * a headless browser render, and on the AI path a model call — seconds at
 * best, and on a slow site the better part of a minute.
 *
 * That second half used to run inside the POST that asked for it, so closing
 * the tab or clicking through to another page abandoned it: the crawl kept
 * going server-side with nobody left to receive it, and the reader came back
 * to a product with no context and no explanation. `startProductSetup` now
 * returns as soon as the row exists, and `runProductSetup` carries on after
 * the response has been sent, recording where it got to on the row itself
 * (see PRODUCT_SETUP_STATUSES) so any later page load can say so.
 */

/**
 * A product address as someone types it: `example.com` is taken to mean
 * `https://example.com/`, and `localhost:3000` to mean `http://…` — a dev
 * server on the reader's own machine is almost never serving TLS, and
 * defaulting it to https read nothing at all. Separate from crawl.ts's
 * normalizeUrl on purpose: that one also resolves links found *on* a page,
 * where a bare `about` is a relative path, and prefixing a scheme there would
 * turn it into a host.
 */
export function normalizeProductUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return normalizeUrl(trimmed);

  const host = trimmed.split(/[/:?#]/)[0].toLowerCase();
  const local =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^127\.|^0\.0\.0\.0$|^10\.|^192\.168\./.test(host);
  return normalizeUrl(`${local ? "http" : "https"}://${trimmed}`);
}

export interface StartedProduct {
  productId: string;
  url: string;
}

/**
 * The fast half: validate the URL and make sure a row exists, so the caller
 * has somewhere to send the reader immediately.
 */
export async function startProductSetup(input: {
  url: string;
  name?: string;
  /** Who ends up owning the row. Required: a product with no owner is one nobody can be shown. */
  userId: string;
}): Promise<StartedProduct> {
  const url = normalizeProductUrl(input.url);
  if (!url) throw new AppError("INVALID_INPUT", `Not a valid URL: ${input.url}`);

  const name = input.name?.trim() || new URL(url).hostname;

  const [product] = await db
    .insert(schema.products)
    .values({ url, name, userId: input.userId, setupStatus: "pending", setupError: null })
    .onConflictDoUpdate({
      target: [schema.products.userId, schema.products.url],
      // A re-registration is a fresh attempt, so the row goes back to pending
      // and drops whatever the previous attempt had to say about itself.
      set: { name, setupStatus: "pending", setupError: null },
    })
    .returning();

  return { productId: product.id, url };
}

/**
 * The slow half: read the site, work out what it is, and write that down.
 *
 * Never throws. It runs with no caller waiting on it, so the only useful place
 * to put a failure is the row — where the product page reads it back and shows
 * it to the person who asked.
 */
export async function runProductSetup({ productId, url }: StartedProduct): Promise<void> {
  try {
    const pages = await crawlSite(url);

    // crawl_pages is the current snapshot of the site, not a history: re-running
    // registration on the same URL replaces it. Appending instead would list the
    // same page once per run in the UI and double-count it in any later audit.
    // (product_contexts is the versioned table — see saveEditedContext.)
    await db.delete(schema.crawlPages).where(eq(schema.crawlPages.productId, productId));

    for (const page of pages) {
      await db.insert(schema.crawlPages).values({
        productId,
        url: page.url,
        status: page.status,
        title: page.title,
        text: page.text,
        meta: page.meta,
        renderedWith: page.renderedWith,
      });
    }

    const { extraction, analysis } = await readSite(pages);

    const version = await nextContextVersion(productId);
    await db.insert(schema.productContexts).values({
      productId,
      version,
      what: extraction.what,
      who: extraction.who,
      why: extraction.why,
      how: extraction.how,
      sourcePages: extraction.evidenceUrls,
      confidence: extraction.confidence,
      gaps: extraction.gaps,
      analysis,
      primaryLanguage: extraction.primaryLanguage,
      editedByHuman: false,
    });

    // Registration names a product after its hostname because that is all
    // there is to go on before the crawl. Once the site has said what it calls
    // itself, use that — but only while the name is still that placeholder, so
    // a name someone chose on the review screen is never overwritten by a
    // re-read.
    const product = await db.query.products.findFirst({
      where: eq(schema.products.id, productId),
      columns: { name: true },
    });
    const siteName = siteNameFrom(pages);
    const rename = siteName && product?.name === new URL(url).hostname ? { name: siteName } : {};

    await db
      .update(schema.products)
      .set({ setupStatus: "ready", setupError: null, ...rename })
      .where(eq(schema.products.id, productId));
  } catch (error) {
    const shown = toAppError(error);
    const message = shown.hint ?? describeForUser(shown);

    // A brand-new product that could not be read has nothing in it worth
    // keeping — no context, often no readable page either — but it is not
    // deleted the way it once was: the reader is already looking at its page
    // by now, and pulling the row out from under them turns a failure they
    // could act on into a 404 they cannot. It stays, marked failed, with the
    // reason on it and a delete button beside it.
    //
    // A re-registration keeps more than that. It already has a working context
    // from an earlier run, and one failed re-crawl must not discard it — so
    // the error is recorded alongside the old context rather than in place of
    // it, and the page shows both.
    await db
      .update(schema.products)
      .set({ setupStatus: "failed", setupError: message })
      .where(eq(schema.products.id, productId));
  }
}

/**
 * The reading of the site, by whichever route is available.
 *
 * With a model configured this is the full SaaS analysis, and the four Product
 * Context fields are derived from it so that everything downstream keeps
 * working unchanged (see context/derive.ts). Without one — AI is opt-in, see
 * env.ts — it falls back to the rule-based reading, which fills `what` from
 * the page's own metadata and leaves the rest honestly unstated.
 *
 * A model that fails mid-analysis falls back too, rather than failing the
 * registration: a rule-based context is worth more than an error page, and the
 * owner can re-register once the model is reachable again.
 */
async function readSite(
  pages: Awaited<ReturnType<typeof crawlSite>>,
): Promise<{ extraction: ProductContextExtraction; analysis: SaasAnalysis | null }> {
  if (!llmAvailable()) {
    return { extraction: await extractProductContext(pages, null), analysis: null };
  }

  try {
    const analysis = await analyzeSaas(pages, await getProvider());
    return { extraction: contextFromAnalysis(analysis), analysis };
  } catch (error) {
    // A crawl that reached nothing is the caller's failure to report, not
    // something to paper over with a rule-based reading of no pages.
    const code = toAppError(error).code;
    if (code === "CRAWL_EMPTY" || code === "CRAWL_UNREACHABLE") throw error;

    log.warn("product.analysis_failed", describeError(error));
    return { extraction: await extractProductContext(pages, null), analysis: null };
  }
}

async function nextContextVersion(productId: string): Promise<number> {
  const existing = await db.query.productContexts.findMany({
    where: eq(schema.productContexts.productId, productId),
    columns: { version: true },
  });
  return existing.reduce((max, row) => Math.max(max, row.version), 0) + 1;
}
