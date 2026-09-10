import { and, eq } from "drizzle-orm";

import { crawlSite } from "@/core/context/crawl";
import { AppError } from "@/core/errors";
import { extractProductContext } from "@/core/context/extract";
import { getProvider } from "@/core/llm";
import { db, schema } from "@/db/client";
import { normalizeUrl } from "@/core/context/crawl";

/**
 * ① PRODUCT: turns a bare URL into a registered product with an initial
 * Product Context (version 1).
 *
 * Crawl and extraction failures are kept separate from "the product could not
 * be registered at all" — a site that crawls but has no readable page is
 * itself a diagnosable state (spec §6's cold-start audit path leans on this),
 * so the product row is created before the context is attempted, not after.
 */

export interface RegisterProductResult {
  productId: string;
  contextVersion: number;
  extraction: Awaited<ReturnType<typeof extractProductContext>>;
}

export async function registerProduct(input: {
  url: string;
  name?: string;
  /** Who ends up owning the row. Required: a product with no owner is one nobody can be shown. */
  userId: string;
}): Promise<RegisterProductResult> {
  const url = normalizeUrl(input.url);
  if (!url) throw new AppError("INVALID_INPUT", `Not a valid URL: ${input.url}`);

  const name = input.name?.trim() || new URL(url).hostname;

  // Read before writing, only to remember which case this is. onConflictDoUpdate
  // below returns the same row shape either way, with nothing in it saying
  // whether the row is new — and that is exactly what the catch block needs to
  // decide whether a failure gets to undo the insert.
  const existed = Boolean(
    await db.query.products.findFirst({
      where: and(eq(schema.products.userId, input.userId), eq(schema.products.url, url)),
      columns: { id: true },
    }),
  );

  const [product] = await db
    .insert(schema.products)
    .values({ url, name, userId: input.userId })
    .onConflictDoUpdate({
      target: [schema.products.userId, schema.products.url],
      set: { name },
    })
    .returning();

  try {
    const pages = await crawlSite(url);

    // crawl_pages is the current snapshot of the site, not a history: re-running
    // registration on the same URL replaces it. Appending instead would list the
    // same page once per run in the UI and double-count it in any later audit.
    // (product_contexts is the versioned table — see saveEditedContext.)
    await db.delete(schema.crawlPages).where(eq(schema.crawlPages.productId, product.id));

    for (const page of pages) {
      await db.insert(schema.crawlPages).values({
        productId: product.id,
        url: page.url,
        status: page.status,
        title: page.title,
        text: page.text,
        meta: page.meta,
        renderedWith: page.renderedWith,
      });
    }

    const extraction = await extractProductContext(pages, getProvider());

    const version = await nextContextVersion(product.id);
    await db.insert(schema.productContexts).values({
      productId: product.id,
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

    return { productId: product.id, contextVersion: version, extraction };
  } catch (error) {
    // A crawl or extraction failure on a brand-new product leaves nothing
    // usable behind — no context, sometimes no readable page either — so the
    // insert above gets undone rather than stranding an empty row nobody asked
    // for and the UI had no way to remove. Re-registering an existing product
    // is a different story: it already has a working context from a previous
    // run, and deleting it over a re-crawl that happened to fail would destroy
    // the one thing still worth keeping. Cascades (see schema.ts) take
    // crawl_pages and product_contexts with it.
    if (!existed) {
      await db.delete(schema.products).where(eq(schema.products.id, product.id));
    }
    throw error;
  }
}

async function nextContextVersion(productId: string): Promise<number> {
  const existing = await db.query.productContexts.findMany({
    where: eq(schema.productContexts.productId, productId),
    columns: { version: true },
  });
  return existing.reduce((max, row) => Math.max(max, row.version), 0) + 1;
}
