"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Compass, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InsightItem } from "@/components/features/market/insight-item";
import { InsightForm } from "@/components/features/market/insight-form";
import { addMarketInsight, runMarketResearch } from "@/server/actions/market-insights";
import {
  initialResearchActionState,
  type ResearchActionState,
} from "@/server/actions/market-insight-types";
import {
  insightCategories,
  insightCategoryHints,
  insightCategoryLabels,
} from "@/lib/validation/market-insight";
import type { MarketInsight, ResearchRun } from "@/server/firebase/market-insights";

function ResearchButton({ hasInsights }: { hasInsights: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={hasInsights ? "outline" : "primary"}
      size="sm"
      loading={pending}
    >
      {!pending ? <Search className="size-4" aria-hidden /> : null}
      {pending ? "調査しています…" : hasInsights ? "もう一度調査する" : "AIに市場を調べさせる"}
    </Button>
  );
}

function ResearchPendingNote() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <p className="text-sm text-muted-foreground">
      AIがWebを検索して市場を調べています。1〜2分かかることがあります。
    </p>
  );
}

function formatDateTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Market Intelligence: 市場・顧客・競合についてGrapeが把握している内容。
 *
 * 施策を考える土台になる情報のため、「どこで確認したか(情報源URL)」と
 * 「いつ時点の情報か(取得日)」を必ず添える。裏付けが取れなかったものは
 * 推測で埋めず、不明として残す。
 */
export function MarketIntelligence({
  productId,
  productName,
  insights,
  latestRun,
}: {
  productId: string;
  productName: string;
  insights: MarketInsight[];
  latestRun?: ResearchRun;
}) {
  const [researchState, researchAction] = useActionState<ResearchActionState, FormData>(
    runMarketResearch.bind(null, productId),
    initialResearchActionState
  );
  const [isAdding, setIsAdding] = useState(false);

  const hasInsights = insights.length > 0;
  const unconfirmedCount = insights.filter((i) => !i.confirmedAt).length;
  const failureMessage =
    researchState.status === "error"
      ? researchState.message
      : latestRun?.status === "failed"
        ? latestRun.error
        : undefined;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            {productName} の市場
          </h2>
          <p className="text-sm text-muted-foreground">
            AIがWebを検索して調べた内容です。情報源と取得日を添えて表示します。
          </p>
        </div>
        <form action={researchAction} className="flex flex-col items-end gap-2">
          <ResearchButton hasInsights={hasInsights} />
          <ResearchPendingNote />
        </form>
      </div>

      {failureMessage ? (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-destructive">市場調査ができませんでした</p>
            <p className="mt-1 text-destructive/90">{failureMessage}</p>
            <p className="mt-2 text-muted-foreground">
              調査できていないため、内容は表示していません。下の「自分で追加する」から手動で整理することもできます。
            </p>
          </div>
        </div>
      ) : null}

      {researchState.warning ? (
        <div
          role="status"
          className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-foreground" aria-hidden />
          <p className="text-warning-foreground">{researchState.warning}</p>
        </div>
      ) : null}

      {latestRun?.status === "succeeded" ? (
        <p className="text-xs text-muted-foreground">
          最終調査: {formatDateTime(latestRun.finishedAt)}
          {latestRun.model ? ` / ${latestRun.model}` : ""}
          {` / Web検索 ${latestRun.searchCount}回`}
          {unconfirmedCount > 0 ? ` / 未確認 ${unconfirmedCount}件` : " / すべて確認済み"}
        </p>
      ) : null}

      {hasInsights ? (
        <div className="flex flex-col gap-5">
          {insightCategories.map((category) => {
            const items = insights.filter((insight) => insight.category === category);
            if (items.length === 0) {
              return null;
            }
            return (
              <div key={category}>
                <h3 className="text-sm font-medium text-foreground">
                  {insightCategoryLabels[category]}
                </h3>
                <p className="mb-2 text-xs text-muted-foreground">
                  {insightCategoryHints[category]}
                </p>
                <ul className="flex flex-col gap-2">
                  {items.map((insight) => (
                    <InsightItem key={insight.id} insight={insight} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : !failureMessage ? (
        <EmptyState
          icon={Compass}
          title="まだ市場を調べていません"
          description="AIがWebを検索し、ターゲット顧客・顧客の課題・競合・顧客が集まる場所を調べます。確認できなかったことは「不明」として残します。"
        />
      ) : null}

      {isAdding ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">自分で追加する</h3>
          <InsightForm
            action={addMarketInsight.bind(null, productId)}
            submitLabel="追加する"
            onCancel={() => setIsAdding(false)}
            onSuccess={() => setIsAdding(false)}
          />
        </div>
      ) : (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setIsAdding(true)}>
            <Plus className="size-4" aria-hidden />
            自分で追加する
          </Button>
        </div>
      )}
    </section>
  );
}
