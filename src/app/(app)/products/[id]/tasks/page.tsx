import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { estimateActionCostUsd } from "@/core/action/channel";
import { Page, PageHeader } from "@/components/ui/page";
import { findOwnedProduct } from "@/core/product/ownership";
import { loadSettings } from "@/core/settings";
import { db, schema } from "@/db/client";
import { requireUser } from "@/server/auth/current-user";

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

  // Scoped to the signed-in account, and indistinguishable from a product that
  // does not exist: a separate "not yours" would confirm the id is real.
  const product = await findOwnedProduct(id, (await requireUser()).id);
  if (!product) notFound();

  // The effective value, not the raw .env one — GRAPE_ACTION_DRY_RUN can now
  // be flipped from /settings (see settings/dry-run-toggle.tsx) and this page
  // must reflect that on the very next load, not just after a restart.
  const settings = await loadSettings();

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
    <Page>
      <PageHeader
        title="診断とやること"
        description="いま何が一番の問題で、それに対して何をするか。"
      />

      <DiagnosisPanel
        productId={id}
        diagnosis={latestDiagnosis}
        tasks={tasks}
        dryRun={settings.GRAPE_ACTION_DRY_RUN}
      />
    </Page>
  );
}
