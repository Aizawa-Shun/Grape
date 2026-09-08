import type { Diagnosis } from "@/core/intelligence/diagnose";
import type { Task } from "@/core/intelligence/recommend";

import { RunDiagnosisButton } from "./run-diagnosis-button";
import { TaskCard } from "./task-card";

type ArtifactRow = { id: string; kind: string; content: string; createdAt: Date };
type ActionRunRow = {
  id: string;
  status: "pending" | "dry_run" | "sent" | "failed";
  externalUrl: string | null;
  costEstimateUsd: number | null;
  response: unknown;
};
type OutcomeRow = { before: number; after: number; delta: number; windowDays: number };

interface TaskWithExtras extends Task {
  artifact: ArtifactRow | null;
  actionRun: ActionRunRow | null;
  costEstimateUsd: number | null;
  outcome: OutcomeRow | null;
}

interface Props {
  productId: string;
  diagnosis: Diagnosis | null;
  tasks: TaskWithExtras[];
}

const STAGE_LABELS: Record<string, string> = {
  reach: "Reach",
  visit: "Visit",
  engage: "Engage",
  activate: "Activate",
  retain: "Retain",
};

/**
 * The Decision layer's output plus, now that M4 exists, the Action layer's
 * controls — generate/approve/skip live in TaskCard per task. This panel is
 * just the diagnosis summary and the list.
 */
export function DiagnosisPanel({ productId, diagnosis, tasks }: Props) {
  if (!diagnosis) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-zinc-400">まだ診断を実行していません。</p>
        <RunDiagnosisButton productId={productId} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-md border border-zinc-200 px-3 py-3 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-400">
            {diagnosis.mode === "audit" ? "サイト監査" : "ファネル診断"} ·{" "}
            {diagnosis.createdAt.toLocaleString("ja-JP")}
          </span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-400">
            ボトルネック: {STAGE_LABELS[diagnosis.bottleneckStage] ?? diagnosis.bottleneckStage}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-sm">{diagnosis.summary}</p>
        {diagnosis.confidence !== null && (
          <span className="text-xs text-zinc-400">確信度: {(diagnosis.confidence * 100).toFixed(0)}%</span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-zinc-500">今週のタスク</h3>
          <RunDiagnosisButton productId={productId} />
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-zinc-400">この診断からはタスクが生成されていません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                artifact={task.artifact}
                actionRun={task.actionRun}
                costEstimateUsd={task.costEstimateUsd}
                outcome={task.outcome}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
