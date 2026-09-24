import { and, eq, ne } from "drizzle-orm";

import { AppError } from "@/core/errors";
import { db, schema, type Database } from "@/db/client";

import { normalizeProductUrl } from "./register";

export type Product = typeof schema.products.$inferSelect;

export interface ProductEdit {
  name?: string;
  url?: string;
  keyEventName?: string | null;
}

/**
 * The product's own fields: its name, its address, and the key event.
 *
 * Only what is passed changes — the key-event form sends one field, the review
 * screen sends two, and neither should have to know the other's. The key
 * event is what turns on the Activate (and, transitively, Retain) stage of
 * the funnel — see core/data/funnel.ts.
 *
 * Changing the URL does not re-read the site by itself: the caller decides
 * that (see POST /api/products/[id]/reread), because a rename of the same
 * site — www. added, http → https — should not throw away a context someone
 * already corrected.
 *
 * Takes the owner explicitly and checks it in the WHERE clause rather than in
 * a lookup before it: one statement, so there is no gap between deciding and
 * writing.
 */
export async function updateProduct(
  productId: string,
  userId: string,
  edit: ProductEdit,
  database: Database = db,
): Promise<Product> {
  const set: Partial<typeof schema.products.$inferInsert> = {};
  if (edit.name !== undefined) set.name = edit.name;
  if (edit.keyEventName !== undefined) set.keyEventName = edit.keyEventName;

  if (edit.url !== undefined) {
    const url = normalizeProductUrl(edit.url);
    if (!url) {
      throw new AppError("INVALID_INPUT", `Not a valid URL: ${edit.url}`, {
        hint: "URLの形式で入力してください。",
      });
    }
    // (userId, url) is unique: one account cannot register a site twice.
    // Asked first so the answer can say which way it collided, rather than
    // surfacing as a bare constraint error from the driver.
    const clash = await database.query.products.findFirst({
      where: and(
        eq(schema.products.userId, userId),
        eq(schema.products.url, url),
        ne(schema.products.id, productId),
      ),
      columns: { id: true },
    });
    if (clash) {
      throw new AppError("CONFLICT", `Another product already uses ${url}`, {
        hint: "そのURLは別のサービスとして登録済みです。",
      });
    }
    set.url = url;
  }

  if (Object.keys(set).length === 0) {
    throw new AppError("INVALID_INPUT", "Nothing to update");
  }

  const [updated] = await database
    .update(schema.products)
    .set(set)
    .where(and(eq(schema.products.id, productId), eq(schema.products.userId, userId)))
    .returning();

  if (!updated) throw new AppError("NOT_FOUND", `No product ${productId} for this account`);
  return updated;
}
