"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cx } from "@/components/ui/cx";
import { Meter } from "@/components/ui/meter";
import { Status } from "@/components/ui/status";
import { STAGE_UI } from "@/core/data/stages";
import type { Task } from "@/core/intelligence/recommend";

type Artifact = { id: string; kind: string; content: string; createdAt: Date };
type ActionRun = {
  id: string;
  status: "pending" | "dry_run" | "sent" | "failed";
  externalUrl: string | null;
  costEstimateUsd: number | null;
  response: unknown;
};
type Outcome = { before: number; after: number; delta: number; windowDays: number };

interface Props {
  task: Task;
  artifact: Artifact | null;
  actionRun: ActionRun | null;
  costEstimateUsd: number | null;
  outcome: Outcome | null;
  /** Whether a real send is possible at all right now — GRAPE_ACTION_DRY_RUN. */
  dryRun: boolean;
}

const CHANNEL_COPY: Record<string, { where: string; note: string }> = {
  manual: {
    where: "自分で使う",
    note: "Grapeからは何も送りません。できた文面をコピーして、自分で貼ってください。",
  },
  x: {
    where: "Xに投稿",
    note: "あなたのXアカウントから実際に投稿されます。取り消せません。",
  },
};

function failureMessage(run: ActionRun): string | null {
  if (run.status !== "failed") return null;
  const response = run.response;
  if (response && typeof response === "object" && "error" in response) {
    return String((response as { error: unknown }).error);
  }
  return "実行できませんでした。";
}

/**
 * One task, from proposal to measured result.
 *
 * The approval step expands in place rather than opening a dialog: it has to
 * show what is about to happen, where, and what it costs, and an inline block
 * gets that right without hand-rolling a focus trap. Two deliberate presses,
 * because on the X channel the second one spends money and cannot be undone.
 */
export function TaskCard({ task, artifact, actionRun, costEstimateUsd, outcome, dryRun }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"generate" | "approve" | "skip" | "measure" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const channel = CHANNEL_COPY[task.channel] ?? { where: task.channel, note: "" };
  const done = task.status === "done";
  const skipped = task.status === "skipped";
  const failure = actionRun ? failureMessage(actionRun) : null;
  const willReallySend = !dryRun && task.channel !== "manual";

  function run(kind: NonNullable<typeof busy>, url: string, body?: unknown) {
    setBusy(kind);
    setError(null);
    // The refresh runs inside the same transition as the request, so `pending`
    // stays true until the re-rendered page is actually on screen. Without
    // that the button returned to normal while nothing had visibly changed.
    startTransition(async () => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: body ? { "content-type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(payload.error ?? "うまくいきませんでした。もう一度お試しください。");
          return;
        }
        setConfirming(false);
        router.refresh();
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <li
      className={cx(
        "flex flex-col gap-3 rounded-md border",
        // A dropped task stays visible — you decided that, and it should be
        // possible to see what you decided — but it stops competing with the
        // ones still live: dashed, sunken, and no lift off the page.
        skipped
          ? "border-dashed border-border bg-surface-sunken/40 p-3"
          : "border-border bg-surface p-4 shadow-card",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 className={skipped ? "font-medium text-text-muted line-through" : "font-medium"}>
          {task.title}
        </h4>
        <Badge>{channel.where}</Badge>
      </div>

      {skipped ? (
        <p className="text-sm text-text-muted">やらないことにしました。</p>
      ) : (
        <>
          <p className="text-sm text-text-muted">{task.rationale}</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md bg-surface-sunken px-3 py-2.5 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-xs text-text-muted">ねらい</dt>
              <dd className="text-xs">
                {STAGE_UI[task.stage].label}を
                {task.expectedDirection === "up" ? "増やす" : "減らす"}
              </dd>
            </div>
            <Meter label="効きそうな度合い" value={task.impact} />
            <Meter label="かかる手間" value={task.effort} />
          </dl>
        </>
      )}

      {artifact && !skipped && (
        <div className="rounded-md bg-surface-sunken px-3 py-2.5 text-sm">
          <p className="whitespace-pre-wrap">{artifact.content}</p>
        </div>
      )}

      {done && actionRun?.status === "dry_run" && (
        <Status>
          練習モードで実行しました。実際には送っていません。本当に送るには、設定ファイルで練習モードを解除してください。
        </Status>
      )}
      {done && actionRun?.status === "sent" && (
        <Status>
          送信しました。
          {actionRun.externalUrl && (
            <>
              {" "}
              <a
                href={actionRun.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                投稿を見る
              </a>
            </>
          )}
        </Status>
      )}

      {done && outcome && (
        <p className="text-sm">
          <span className="text-text-muted">
            {outcome.windowDays}日後の{STAGE_UI[task.stage].label}:{" "}
          </span>
          {outcome.before} 人 → {outcome.after} 人{" "}
          <span
            className={
              outcome.delta > 0
                ? "text-positive"
                : outcome.delta < 0
                  ? "text-negative"
                  : "text-text-muted"
            }
          >
            ({outcome.delta > 0 ? "+" : ""}
            {outcome.delta})
          </span>
        </p>
      )}

      {failure && <Status tone="error">{failure}</Status>}
      {error && <Status tone="error">{error}</Status>}

      {confirming && artifact && (
        <Callout tone={willReallySend ? "attention" : "info"} title="この内容で実行します">
          <dl className="flex flex-col gap-1">
            <div className="flex gap-2">
              <dt className="text-text-muted">送り先</dt>
              <dd className="font-medium">{channel.where}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-text-muted">かかる費用</dt>
              <dd className="font-medium">
                {costEstimateUsd && costEstimateUsd > 0
                  ? `約 $${costEstimateUsd.toFixed(3)}`
                  : "かかりません"}
              </dd>
            </div>
          </dl>
          <p className="mt-2">
            {dryRun && task.channel !== "manual"
              ? "いまは練習モードです。内容が記録されるだけで、実際には送られません。"
              : channel.note}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant={willReallySend ? "danger" : "primary"}
              size="sm"
              loading={busy === "approve" && pending}
              onClick={() =>
                run("approve", `/api/tasks/${task.id}/approve`, { artifactId: artifact.id })
              }
            >
              {willReallySend ? "本当に送る" : "実行する"}
            </Button>
            <Button size="sm" disabled={pending} onClick={() => setConfirming(false)}>
              やめる
            </Button>
          </div>
        </Callout>
      )}

      {!done && !skipped && !confirming && (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            loading={busy === "generate" && pending}
            disabled={pending}
            onClick={() => run("generate", `/api/tasks/${task.id}/artifact`)}
          >
            {busy === "generate" && pending
              ? "文面を作っています…"
              : artifact
                ? "作り直す"
                : "文面を作る"}
          </Button>

          {artifact && (
            <Button
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={() => setConfirming(true)}
            >
              {failure ? "もう一度実行する" : "内容を確認して実行"}
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            loading={busy === "skip" && pending}
            disabled={pending}
            onClick={() => run("skip", `/api/tasks/${task.id}/skip`)}
          >
            やらない
          </Button>
        </div>
      )}

      {done && !outcome && (
        <div>
          <Button
            size="sm"
            loading={busy === "measure" && pending}
            disabled={pending}
            onClick={() => run("measure", `/api/tasks/${task.id}/outcome`)}
          >
            {busy === "measure" && pending ? "測っています…" : "効果を測る"}
          </Button>
        </div>
      )}
    </li>
  );
}
