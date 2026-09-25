import { notFound } from "next/navigation";

import { estimateActionCostUsd } from "@/core/action/channel";
import { Page, PageHeader } from "@/components/ui/page";
import { findCarriedOverTasks } from "@/core/intelligence/carried-over";
import { findOwnedProduct } from "@/core/product/ownership";
import { loadSettings } from "@/core/settings";
import { db } from "@/db/client";
import type { Task } from "@/db/schema";
import { by, firstBy } from "@/db/sort";
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

  const latestDiagnosis = firstBy(
    await db.diagnoses.find({ where: [["productId", "==", id]] }),
    by((diagnosis) => diagnosis.createdAt, "desc"),
  );

  const tasksRaw = latestDiagnosis
    ? (await db.tasks.find({ where: [["diagnosisId", "==", latestDiagnosis.id]] })).sort(
        by((task) => task.impact, "desc"),
      )
    : [];

  // Each task's latest artifact (if generated), latest action run (if
  // approved) and latest outcome (if measured). Per task, because each card
  // needs only its own newest one of each and a task list this small does not
  // warrant fetching everything and grouping.
  const newest = <T,>(rows: T[], at: (row: T) => Date): T | null => firstBy(rows, by(at, "desc"));
  const withExtras = async (task: Task) => {
    const [artifacts, actionRuns, outcomes] = await Promise.all([
      db.artifacts.find({ where: [["taskId", "==", task.id]] }),
      db.actionRuns.find({ where: [["taskId", "==", task.id]] }),
      db.outcomes.find({ where: [["taskId", "==", task.id]] }),
    ]);
    const artifact = newest(artifacts, (row) => row.createdAt);
    const actionRun = newest(actionRuns, (row) => row.createdAt);
    const outcome = newest(outcomes, (row) => row.evaluatedAt);
    const costEstimateUsd = artifact ? estimateActionCostUsd(task.channel, artifact.content) : null;
    return { ...task, artifact, actionRun, costEstimateUsd, outcome };
  };

  const tasks = await Promise.all(tasksRaw.map(withExtras));

  // Unfinished work from earlier rounds — see findCarriedOverTasks for why.
  const earlierRaw = await findCarriedOverTasks(id, latestDiagnosis?.id ?? null);
  const carriedOver = await Promise.all(earlierRaw.map(withExtras));

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
        carriedOver={carriedOver}
        dryRun={settings.GRAPE_ACTION_DRY_RUN}
      />
    </Page>
  );
}
