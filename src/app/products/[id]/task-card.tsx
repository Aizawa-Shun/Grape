"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
}

function formatRating(n: number): string {
  return "●".repeat(n) + "○".repeat(5 - n);
}

function runErrorMessage(run: ActionRun): string | null {
  if (run.status !== "failed") return null;
  const response = run.response;
  if (response && typeof response === "object" && "error" in response) {
    return String((response as { error: unknown }).error);
  }
  return "実行に失敗しました。";
}

/**
 * One task's whole lifecycle in place: generate an artifact, see its cost
 * estimate, approve it (which is also where GRAPE_ACTION_DRY_RUN actually
 * takes effect — see execute.ts), or skip it outright. A failed run leaves
 * the task retryable rather than dead, so "承認して実行" stays available.
 */
export function TaskCard({ task, artifact, actionRun, costEstimateUsd, outcome }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"generate" | "approve" | "skip" | "evaluate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, body?: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const responseBody = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(responseBody.error ?? `Request failed (${response.status})`);
    return responseBody;
  }

  async function handleGenerate() {
    setBusy("generate");
    setError(null);
    try {
      await post(`/api/tasks/${task.id}/artifact`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleApprove() {
    if (!artifact) return;
    setBusy("approve");
    setError(null);
    try {
      await post(`/api/tasks/${task.id}/approve`, { artifactId: artifact.id });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSkip() {
    setBusy("skip");
    setError(null);
    try {
      await post(`/api/tasks/${task.id}/skip`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleEvaluate() {
    setBusy("evaluate");
    setError(null);
    try {
      await post(`/api/tasks/${task.id}/outcome`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const done = task.status === "done";
  const skipped = task.status === "skipped";
  const failure = actionRun ? runErrorMessage(actionRun) : null;

  return (
    <li className="flex flex-col gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <span className={`font-medium ${skipped ? "text-zinc-400 line-through" : ""}`}>{task.title}</span>
        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800">
          {task.channel}
        </span>
      </div>

      {!skipped && (
        <>
          <p className="text-zinc-500">{task.rationale}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-zinc-400">
            <span>
              期待する変化: {task.expectedMetric} が{task.expectedDirection === "up" ? "上がる" : "下がる"}
            </span>
            <span>インパクト {formatRating(task.impact)}</span>
            <span>労力 {formatRating(task.effort)}</span>
          </div>
        </>
      )}

      {skipped && <p className="text-xs text-zinc-400">スキップ済み</p>}

      {artifact && !skipped && (
        <div className="rounded bg-zinc-50 px-2 py-1.5 text-xs dark:bg-zinc-900">
          <p className="whitespace-pre-wrap">{artifact.content}</p>
          {costEstimateUsd !== null && costEstimateUsd > 0 && (
            <p className="mt-1 text-zinc-400">推定コスト: ${costEstimateUsd.toFixed(3)}</p>
          )}
        </div>
      )}

      {done && actionRun && (
        <p className="text-xs text-zinc-500">
          {actionRun.status === "dry_run" && "ドライラン — 実際には送信されていません（GRAPE_ACTION_DRY_RUN=true）。"}
          {actionRun.status === "sent" && (
            <>
              送信済み。
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
            </>
          )}
        </p>
      )}

      {done && outcome && (
        <p className="text-xs text-zinc-500">
          効果測定（{outcome.windowDays}日後）: {outcome.before} → {outcome.after}
          {" "}
          <span
            className={
              outcome.delta > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : outcome.delta < 0
                  ? "text-red-500"
                  : ""
            }
          >
            ({outcome.delta > 0 ? "+" : ""}
            {outcome.delta})
          </span>
        </p>
      )}

      {done && !outcome && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleEvaluate}
            disabled={busy !== null}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
          >
            {busy === "evaluate" ? "測定中…" : "効果を測定"}
          </button>
        </div>
      )}

      {failure && <p className="text-xs text-red-600">{failure}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {!done && !skipped && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleGenerate}
            disabled={busy !== null}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-zinc-700"
          >
            {busy === "generate" ? "生成中…" : artifact ? "生成し直す" : "本文を生成"}
          </button>
          {artifact && (
            <button
              onClick={handleApprove}
              disabled={busy !== null}
              className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {busy === "approve" ? "実行中…" : failure ? "承認して再実行" : "承認して実行"}
            </button>
          )}
          <button
            onClick={handleSkip}
            disabled={busy !== null}
            className="rounded-md px-2 py-1 text-xs text-zinc-400 disabled:opacity-50"
          >
            {busy === "skip" ? "…" : "スキップ"}
          </button>
        </div>
      )}
    </li>
  );
}
