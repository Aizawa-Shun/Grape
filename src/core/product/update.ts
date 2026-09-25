import { AppError } from "@/core/errors";
import { db, type Database } from "@/db/client";
import type { Product } from "@/db/schema";

import { normalizeProductUrl } from "./register";

export type { Product };

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
  const set: Partial<Omit<Product, "id">> = {};
  if (edit.name !== undefined) set.name = edit.name;
  if (edit.keyEventName !== undefined) set.keyEventName = edit.keyEventName;

  let url: string | undefined;
  if (edit.url !== undefined) {
    const normalized = normalizeProductUrl(edit.url);
    if (!normalized) {
      throw new AppError("INVALID_INPUT", `Not a valid URL: ${edit.url}`, {
        hint: "URLの形式で入力してください。",
      });
    }
    url = normalized;
    set.url = url;
  }

  if (Object.keys(set).length === 0) {
    throw new AppError("INVALID_INPUT", "Nothing to update");
  }

  // The ownership check, the (userId, url) uniqueness check and the write
  // share one transaction: Firestore has no unique index, so this is what
  // stops two edits racing each other onto the same address.
  const updated = await database.runTransaction(async (tx) => {
    const current = await tx.products.get(productId);
    if (!current || current.userId !== userId) return null;

    if (url !== undefined) {
      const clash = await tx.products.find({
        where: [
          ["userId", "==", userId],
          ["url", "==", url],
        ],
      });
      if (clash.some((product) => product.id !== productId)) {
        throw new AppError("CONFLICT", `Another product already uses ${url}`, {
          hint: "そのURLは別のサービスとして登録済みです。",
        });
      }
    }

    await tx.products.update(productId, set);
    return { ...current, ...set };
  });

  if (!updated) throw new AppError("NOT_FOUND", `No product ${productId} for this account`);
  return updated;
}
