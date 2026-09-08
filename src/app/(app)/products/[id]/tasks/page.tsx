import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { estimateActionCostUsd } from "@/core/action/channel";
import { db, schema } from "@/db/client";
import { env } from "@/env";

import { DiagnosisPanel } from "../diagnosis-panel";

/**
 * The finding and what to do about it, on their own page.
 *
 * Split from the funnel deliberately: the funnel answers "where do people go",
 * this answers "why, and what now". Mixing them meant the numbers and the
 * to-do list competed, and the reader had to scroll past one to act on the
 * other.
 */
export default async function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await db.query.products.findFirst({ where: eq(schema.products.id, id) });
  if (!product) notFound();

  const latestDiagnosis =
    (await db.query.diagnoses.findFirst({
      where: eq(schema.diagnoses.productId, id),
      orderBy: (diagnoses, { desc }) => [desc(diagnoses.createdAt)],
    })) ?? null;

  const tasksRaw = latestDiagnosis
    ? await db.query.tasks.findMany({
        where: eq(schema.tasks.diagnosisId, latestDiagnosis.id),
        orderBy: (tasks, { desc }) => [desc(tasks.impact)],
      })
    : [];

  // Each task's latest artifact (if generated) and latest action run (if
  // approved) — fetched per task since a task list this small does not
  // warrant a join, and keeping it as separate queries keeps each one legible.
  const tasks = await Promise.all(
    tasksRaw.map(async (task) => {
      const artifact =
        (await db.query.artifacts.findFirst({
          where: eq(schema.artifacts.taskId, task.id),
          orderBy: (artifacts, { desc }) => [desc(artifacts.createdAt)],
        })) ?? null;
      const actionRun =
        (await db.query.actionRuns.findFirst({
          where: eq(schema.actionRuns.taskId, task.id),
          orderBy: (actionRuns, { desc }) => [desc(actionRuns.createdAt)],
        })) ?? null;
      const costEstimateUsd = artifact
        ? estimateActionCostUsd(task.channel, artifact.content)
        : null;
      const outcome =
        (await db.query.outcomes.findFirst({
          where: eq(schema.outcomes.taskId, task.id),
          orderBy: (outcomes, { desc }) => [desc(outcomes.evaluatedAt)],
        })) ?? null;
      return { ...task, artifact, actionRun, costEstimateUsd, outcome };
    }),
  );

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">診断とやること</h1>
        <p className="text-sm text-text-muted">
          いま何が一番の問題で、それに対して何をするか。
        </p>
      </header>

      <DiagnosisPanel
        productId={id}
        diagnosis={latestDiagnosis}
        tasks={tasks}
        dryRun={env.GRAPE_ACTION_DRY_RUN}
      />
    </div>
  );
}
