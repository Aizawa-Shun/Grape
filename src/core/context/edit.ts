import { eq } from "drizzle-orm";

import { AppError } from "@/core/errors";
import { db, schema } from "@/db/client";

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

export async function saveEditedContext(productId: string, edits: ContextEditInput): Promise<{ version: number }> {
  const current = await db.query.productContexts.findMany({
    where: eq(schema.productContexts.productId, productId),
    columns: { version: true, sourcePages: true, primaryLanguage: true },
  });

  if (current.length === 0) {
    throw new AppError("NOT_FOUND", `Product ${productId} has no context to edit yet`);
  }

  const latest = current.reduce((max, row) => (row.version > max.version ? row : max));
  const version = latest.version + 1;

  await db.insert(schema.productContexts).values({
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

export async function getLatestContext(productId: string) {
  const rows = await db.query.productContexts.findMany({
    where: eq(schema.productContexts.productId, productId),
  });
  if (rows.length === 0) return null;
  return rows.reduce((max, row) => (row.version > max.version ? row : max));
}
