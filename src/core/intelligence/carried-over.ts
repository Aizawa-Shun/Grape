import { and, eq, inArray, isNull, ne, notExists, or } from "drizzle-orm";

import { db, schema, type Database } from "@/db/client";

export type Task = typeof schema.tasks.$inferSelect;

/**
 * Work from earlier diagnoses that is not finished yet: still open, approved
 * in practice mode, or done and waiting to be measured.
 *
 * The tasks page shows the latest diagnosis's tasks, while the home page's
 * next step (core/product/next-step.ts) looks across every task the product
 * has. Without this, re-diagnosing made the previous round vanish from the
 * tasks page without closing any of it, and a "測ってみる" or "文面を作る" on
 * the home page could send the reader to a card that was no longer there.
 * Nothing is closed on the reader's behalf here either — it is only shown.
 *
 * Skipped and already-measured work is filtered in SQL rather than after the
 * fact: done tasks only accumulate, and each row returned costs the page three
 * more queries for its artifact, run and outcome.
 */
export async function findCarriedOverTasks(
  productId: string,
  latestDiagnosisId: string | null,
  database: Database = db,
): Promise<Task[]> {
  return database.query.tasks.findMany({
    where: and(
      eq(schema.tasks.productId, productId),
      or(
        inArray(schema.tasks.status, ["proposed", "approved"]),
        and(
          eq(schema.tasks.status, "done"),
          notExists(
            database
              .select({ id: schema.outcomes.id })
              .from(schema.outcomes)
              .where(eq(schema.outcomes.taskId, schema.tasks.id)),
          ),
        ),
      ),
      latestDiagnosisId
        ? or(isNull(schema.tasks.diagnosisId), ne(schema.tasks.diagnosisId, latestDiagnosisId))
        : undefined,
    ),
    orderBy: (tasks, { desc }) => [desc(tasks.createdAt)],
  });
}
