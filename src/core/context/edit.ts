import { AppError } from "@/core/errors";
import { db, type Database } from "@/db/client";
import type { ProductContext } from "@/db/schema";
import { by, firstBy } from "@/db/sort";

/**
 * A human correction becomes a new context version rather than an overwrite.
 *
 * This is the other half of the "wrong Context poisons everything downstream"
 * problem: extraction alone cannot be trusted (see extract.ts), and neither
 * can editing be allowed to erase the record of what the model originally
 * produced — a diagnosis references a specific context version, and rewriting
 * that version out from under it would make past diagnoses unauditable.
 */

export interface ContextEditInput {
  what: string;
  who: string;
  why: string;
  how: string;
}

/** Every version of a product's context, newest first. */
export async function contextVersions(productId: string, database: Database = db): Promise<ProductContext[]> {
  const rows = await database.productContexts.find({ where: [["productId", "==", productId]] });
  return rows.sort(by((row) => row.version, "desc"));
}

export async function getLatestContext(productId: string, database: Database = db): Promise<ProductContext | null> {
  return firstBy(
    await database.productContexts.find({ where: [["productId", "==", productId]] }),
    by((row) => row.version, "desc"),
  );
}

/** The one version a diagnosis reasoned over. */
export async function getContextVersion(
  productId: string,
  version: number,
  database: Database = db,
): Promise<ProductContext | null> {
  return database.productContexts.first({
    where: [
      ["productId", "==", productId],
      ["version", "==", version],
    ],
  });
}

export async function saveEditedContext(
  productId: string,
  edits: ContextEditInput,
  database: Database = db,
): Promise<{ version: number }> {
  const latest = await getLatestContext(productId, database);
  if (!latest) {
    throw new AppError("NOT_FOUND", `Product ${productId} has no context to edit yet`);
  }

  const version = latest.version + 1;
  await database.productContexts.insert({
    productId,
    version,
    what: edits.what,
    who: edits.who,
    why: edits.why,
    how: edits.how,
    sourcePages: latest.sourcePages,
    primaryLanguage: latest.primaryLanguage,
    // The human is now the source of truth for what/who/why/how, so whatever
    // the original extraction couldn't determine no longer applies as-is.
    gaps: [],
    confidence: 1,
    editedByHuman: true,
  });

  return { version };
}
