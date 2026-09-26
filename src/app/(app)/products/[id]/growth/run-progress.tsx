"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Spinner } from "@/components/ui/spinner";
import { cx } from "@/components/ui/cx";
import type { GrowthStepKind, GrowthStepStatus } from "@/db/schema";

import { send } from "./request";

export interface RunView {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  steps: { kind: GrowthStepKind; status: GrowthStepStatus; summary: string | null; error: string | null; attempts: number }[];
}

const LABELS: Record<GrowthStepKind, string> = {
  product: "あなたのプロダクトを読んでいます",
  market: "市場で何が語られているかを調べています",
  competitors: "競合を調べています",
  audience: "誰を狙うべきかを考えています",
  positioning: "ポジショニングを決めています",
  strategy: "マーケティング戦略を立てています",
  experiments: "検証する仮説を立てています",
  ideas: "投稿のネタを出しています",
  content: "下書きを書いています",
  opportunities: "見込み客の会話を探しています",
  watch: "競合のサイトの変化を確認しています",
  metrics: "Xの数字を集めています",
  measure: "結果を計測しています",
  learn: "結果から学んでいます",
  revise: "戦略を見直しています",
  autopilot: "ルールの範囲で実行しています",
};

const DONE: Record<GrowthStepKind, string> = {
  product: "プロダクトの理解",
  market: "市場調査",
  competitors: "競合調査",
  audience: "狙う相手",
  positioning: "ポジショニング",
  strategy: "戦略",
  experiments: "仮説",
  ideas: "投稿のネタ",
  content: "下書き",
  opportunities: "見込み客の探索",
  watch: "競合の動き",
  metrics: "Xの数字",
  measure: "計測",
  learn: "学び",
  revise: "戦略の見直し",
  autopilot: "自動実行",
};

/** How long to wait before asking again when another request holds the step. */
const BUSY_RETRY_MS = 4_000;

/**
 * A run, step by step, as it happens (spec §30).
 *
 * This screen is also what drives the run: each step executes inside the
 * request it sends (api/growth/runs/[runId]/advance), because Grape's host
 * only runs code while a request is open. Leaving the page pauses the run;
 * coming back, or the daily schedule, carries it on from where it stopped.
 */
export function RunProgress({ initial }: { initial: RunView }) {
  const router = useRouter();
  const [run, setRun] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const stopped = useRef(false);
  // The loop starts from the state the page rendered; a server re-render
  // hands in a fresh object for the same run, which must not restart it.
  const start = useRef(initial);
  const runId = initial.id;

  useEffect(() => {
    stopped.current = false;
    const tick = setInterval(() => setSeconds((s) => s + 1), 1_000);

    async function loop() {
      let current = start.current;
      while (!stopped.current && (current.status === "pending" || current.status === "running")) {
        const before = JSON.stringify(current.steps.map((s) => [s.status, s.attempts]));
        const result = await send<{ run: RunView }>(`/api/growth/runs/${runId}/advance`, "POST");
        if (stopped.current) return;
        if (!result.ok) {
          setError(result.error);
          return;
        }
        current = result.data.run;
        setRun(current);
        // Nothing moved: another tab (or the schedule) is running this step.
        if (JSON.stringify(current.steps.map((s) => [s.status, s.attempts])) === before) {
          await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
        }
      }
      if (!stopped.current) router.refresh();
    }
    void loop();

    return () => {
      stopped.current = true;
      clearInterval(tick);
    };
  }, [runId, router]);

  const finished = run.status === "completed" || run.status === "failed";

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-card" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {!finished && <Spinner className="text-accent" />}
        <span className="text-sm font-medium">{finished ? "完了しました" : "AIが作業しています"}</span>
        {!finished && <span className="text-xs tabular-nums text-text-subtle">{seconds}秒</span>}
      </div>
      <ol className="flex flex-col gap-2">
        {run.steps.map((step, index) => (
          <li key={`${step.kind}-${index}`} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2 text-sm">
              <StepMark status={step.status} />
              <span className={cx(step.status === "pending" ? "text-text-subtle" : "text-text")}>
                {step.status === "running" || step.status === "pending" ? LABELS[step.kind] : DONE[step.kind]}
              </span>
              {step.status === "running" && step.attempts > 1 && <span className="text-xs text-text-subtle">（再試行中）</span>}
            </div>
            {step.summary && step.status !== "running" && <p className="pl-6 text-xs text-text-muted">{step.summary}</p>}
            {step.error && <p className="pl-6 text-xs text-negative">{step.error}</p>}
          </li>
        ))}
      </ol>
      {error && <p className="text-xs text-negative">{error}</p>}
      {!finished && (
        <p className="text-xs text-text-muted">
          1つの手順に1〜2分かかることがあります。このページを閉じると一時停止し、次に開いたとき（または毎日の自動実行で）続きから再開します。
        </p>
      )}
    </div>
  );
}

function StepMark({ status }: { status: GrowthStepStatus }) {
  if (status === "running") return <Spinner className="size-4 text-accent" />;
  const mark = { pending: "○", completed: "✓", skipped: "–", failed: "!" }[status];
  const tone = { pending: "text-text-subtle", completed: "text-positive", skipped: "text-text-subtle", failed: "text-negative" }[status];
  return (
    <span aria-hidden="true" className={cx("inline-flex w-4 justify-center font-medium", tone)}>
      {mark}
    </span>
  );
}
