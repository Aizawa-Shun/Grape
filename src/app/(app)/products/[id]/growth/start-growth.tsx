"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { inlineControlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

import { send } from "./request";

/**
 * Steps 5–7 of the first-run experience (spec §35): "100 users を目指しますか？",
 * set the goal, and hand the rest to the agent. One screen, one button — the
 * numbers are pre-filled, so accepting the default is a single click.
 */
export function StartGrowth({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter();
  const [target, setTarget] = useState("100");
  const [days, setDays] = useState("30");
  const [metric, setMetric] = useState<"signups" | "activations" | "paid" | "visitors">("signups");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const goal = await send(`/api/growth/${productId}/goal`, "PUT", { metric, target, days });
      if (!goal.ok) return setError(goal.error);
      const run = await send(`/api/growth/${productId}/runs`, "POST", { kind: "initial" });
      if (!run.ok) return setError(run.error);
      router.refresh();
    });
  }

  return (
    <form onSubmit={start} className="flex flex-col gap-5 rounded-md border border-border bg-surface p-5 shadow-card">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight">{productName}を、何人に使ってもらいますか？</h2>
        <p className="text-sm text-text-muted">
          Grapeがあなたの製品と市場を調べ、誰に何を言うかを決め、確かめたい仮説と1週間分の投稿を用意します。
          結果を見て、何が効いたかを学び、次の戦略を直していきます。あなたがやるのは、投稿の確認と承認です。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          aria-label="日数"
          inputMode="numeric"
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className={`${inlineControlClass} w-20 text-right tabular-nums`}
        />
        <span>日で</span>
        <select aria-label="数えるもの" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)} className={`${inlineControlClass} w-auto`}>
          <option value="signups">登録ユーザー</option>
          <option value="activations">アクティブユーザー</option>
          <option value="paid">有料ユーザー</option>
          <option value="visitors">訪問者</option>
        </select>
        <span>を</span>
        <input
          aria-label="目標の人数"
          inputMode="numeric"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className={`${inlineControlClass} w-24 text-right tabular-nums`}
        />
        <span>人</span>
      </div>

      <ul className="flex flex-col gap-1 text-xs text-text-muted">
        <li>・ 進み具合は、サイトに貼った計測コードの実際の数で数えます（手入力はしません）。</li>
        <li>・ 何かを投稿・返信するときは、必ずあなたの承認を待ちます（あとで設定から変えられます）。</li>
        <li>・ 調査にはAIの利用料（Web検索を含む）がかかり、あなたの月の上限の範囲で動きます。実績は「AI利用料」で確認できます。</li>
      </ul>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          {pending ? "準備しています…" : "この目標で始める"}
        </Button>
      </div>
      {error && <Status tone="error">{error}</Status>}
    </form>
  );
}
