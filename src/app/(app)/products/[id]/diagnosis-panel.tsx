import { Card } from "@/components/ui/card";
import { STAGE_UI } from "@/core/data/stages";
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
  dryRun: boolean;
}

/**
 * The finding, then what to do about it. The stage is stated as a sentence
 * rather than as a labelled field, because "ボトルネック: Engage" requires
 * knowing two things the reader has not been told.
 */
export function DiagnosisPanel({ productId, diagnosis, tasks, dryRun }: Props) {
  if (!diagnosis) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-muted">
          まだ調べていません。人がまだ来ていなくても、サイト自体を見て何から始めるべきかは出せます。
        </p>
        <RunDiagnosisButton productId={productId} label="はじめて調べる" />
      </div>
    );
  }

  const stage = STAGE_UI[diagnosis.bottleneckStage];
  const open = tasks.filter((task) => task.status !== "done" && task.status !== "skipped");

  return (
    <div className="flex flex-col gap-5">
      <Card emphasis="attention" className="flex flex-col gap-2">
        <p className="text-sm">
          いま一番の問題は{" "}
          <span className="font-semibold">「{stage.label}」</span> の段階です。
        </p>
        <p className="whitespace-pre-wrap text-sm">{diagnosis.summary}</p>
        <p className="text-xs text-text-muted">
          {diagnosis.mode === "audit"
            ? "まだ訪問が少ないので、サイトの内容そのものを見て判断しました。"
            : "実際の訪問データから判断しました。"}
          {diagnosis.confidence !== null &&
            `この説明の確からしさは ${Math.round(diagnosis.confidence * 100)}% です。`}
          {" "}
          {diagnosis.createdAt.toLocaleString("ja-JP")}
        </p>
      </Card>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-text-muted">
            {open.length > 0 ? `やること（残り${open.length}件）` : "やること"}
          </h3>
          <RunDiagnosisButton productId={productId} label="調べ直す" />
        </div>

        {tasks.length === 0 ? (
          <p className="text-sm text-text-muted">
            この診断からは、やることが出ませんでした。もう一度調べ直してみてください。
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                artifact={task.artifact}
                actionRun={task.actionRun}
                costEstimateUsd={task.costEstimateUsd}
                outcome={task.outcome}
                dryRun={dryRun}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
