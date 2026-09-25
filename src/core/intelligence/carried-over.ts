import { db, type Database } from "@/db/client";
import type { Task } from "@/db/schema";
import { by } from "@/db/sort";

export type { Task };

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
 * One read of the product's tasks and one of the outcomes for its done ones;
 * the filtering is code. A product's task list is small, and this avoids both
 * a composite index and a query per task.
 */
export async function findCarriedOverTasks(
  productId: string,
  latestDiagnosisId: string | null,
  database: Database = db,
): Promise<Task[]> {
  const tasks = (await database.tasks.find({ where: [["productId", "==", productId]] })).filter(
    (task) => latestDiagnosisId === null || task.diagnosisId !== latestDiagnosisId,
  );

  const done = tasks.filter((task) => task.status === "done");
  const measured = new Set(
    done.length === 0
      ? []
      : (await database.outcomes.find({ where: [["taskId", "in", done.map((task) => task.id)]] })).map(
          (outcome) => outcome.taskId,
        ),
  );

  return tasks
    .filter(
      (task) =>
        task.status === "proposed" ||
        task.status === "approved" ||
        (task.status === "done" && !measured.has(task.id)),
    )
    .sort(by((task) => task.createdAt, "desc"));
}
