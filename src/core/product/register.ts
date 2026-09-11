import { eq } from "drizzle-orm";

import { crawlSite } from "@/core/context/crawl";
import { AppError, toAppError } from "@/core/errors";
import { extractProductContext } from "@/core/context/extract";
import { getProvider, llmAvailable } from "@/core/llm";
import { db, schema } from "@/db/client";
import { normalizeUrl } from "@/core/context/crawl";
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
  const url = normalizeUrl(input.url);
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

    // No AI configured is not a failure here — the rule-based reading inside
    // extractProductContext is the actual product understanding on a Grape
    // with no LLM_PROVIDER set, not an error state to refuse registration
    // over.
    const extraction = await extractProductContext(pages, llmAvailable() ? getProvider() : null);

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
      primaryLanguage: extraction.primaryLanguage,
      editedByHuman: false,
    });

    await db
      .update(schema.products)
      .set({ setupStatus: "ready", setupError: null })
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

async function nextContextVersion(productId: string): Promise<number> {
  const existing = await db.query.productContexts.findMany({
    where: eq(schema.productContexts.productId, productId),
    columns: { version: true },
  });
  return existing.reduce((max, row) => Math.max(max, row.version), 0) + 1;
}
