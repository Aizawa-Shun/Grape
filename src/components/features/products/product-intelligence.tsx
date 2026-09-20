"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Brain, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FactItem } from "@/components/features/products/fact-item";
import { FactForm } from "@/components/features/products/fact-form";
import { addProductFact, runProductAnalysis } from "@/server/actions/product-facts";
import {
  initialAnalysisActionState,
  type AnalysisActionState,
} from "@/server/actions/product-fact-types";
import { factCategories, factCategoryLabels } from "@/lib/validation/product-fact";
import type { AnalysisRun, ProductFact } from "@/server/firebase/product-facts";

function AnalyzeButton({ hasFacts }: { hasFacts: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={hasFacts ? "outline" : "primary"} size="sm" loading={pending}>
      {!pending ? <Sparkles className="size-4" aria-hidden /> : null}
      {pending ? "分析しています…" : hasFacts ? "もう一度分析する" : "AIに分析させる"}
    </Button>
  );
}

function AnalysisPendingNote() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <p className="text-sm text-muted-foreground">
      サイトを読み込んでAIが整理しています。30秒ほどかかることがあります。
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
 * Product Intelligence: Grapeがプロダクトをどう理解しているかを示す画面。
 *
 * この画面の目的は「AIの理解が正しいかを利用者が確認し、必要なら直せること」。
 * そのため、AIの出力をそのまま正解として見せず、事実・仮説・不明を必ず区別し、
 * 根拠と取得元を併記する。分析できなかった場合は理由を明示し、内容を推測で埋めない。
 */
export function ProductIntelligence({
  productId,
  facts,
  latestRun,
}: {
  productId: string;
  facts: ProductFact[];
  latestRun?: AnalysisRun;
}) {
  const [analysisState, analysisAction] = useActionState<AnalysisActionState, FormData>(
    runProductAnalysis.bind(null, productId),
    initialAnalysisActionState
  );
  const [isAdding, setIsAdding] = useState(false);

  const hasFacts = facts.length > 0;
  const unconfirmedCount = facts.filter((f) => !f.confirmedAt).length;
  const failureMessage =
    analysisState.status === "error"
      ? analysisState.message
      : latestRun?.status === "failed"
        ? latestRun.error
        : undefined;
  const warning = analysisState.warning;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Grapeの理解</h2>
          <p className="text-sm text-muted-foreground">
            このサービスについてGrapeが把握している内容です。事実と仮説を分けて表示します。
          </p>
        </div>
        <form action={analysisAction} className="flex flex-col items-end gap-2">
          <AnalyzeButton hasFacts={hasFacts} />
          <AnalysisPendingNote />
        </form>
      </div>

      {failureMessage ? (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-destructive">AIによる分析ができませんでした</p>
            <p className="mt-1 text-destructive/90">{failureMessage}</p>
            <p className="mt-2 text-muted-foreground">
              分析できていないため、内容は表示していません。下の「自分で追加する」から手動で整理することもできます。
            </p>
          </div>
        </div>
      ) : null}

      {warning ? (
        <div
          role="status"
          className="flex gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning-foreground" aria-hidden />
          <p className="text-warning-foreground">{warning}</p>
        </div>
      ) : null}

      {latestRun?.status === "succeeded" ? (
        <p className="text-xs text-muted-foreground">
          最終分析: {formatDateTime(latestRun.finishedAt)}
          {latestRun.model ? ` / ${latestRun.model}` : ""}
          {latestRun.fetchedPage ? " / サイトの内容を参照" : " / 登録内容のみから分析"}
          {unconfirmedCount > 0 ? ` / 未確認 ${unconfirmedCount}件` : " / すべて確認済み"}
        </p>
      ) : null}

      {hasFacts ? (
        <div className="flex flex-col gap-5">
          {factCategories.map((category) => {
            const items = facts.filter((fact) => fact.category === category);
            if (items.length === 0) {
              return null;
            }
            return (
              <div key={category}>
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                  {factCategoryLabels[category]}
                </h3>
                <ul className="flex flex-col gap-2">
                  {items.map((fact) => (
                    <FactItem key={fact.id} fact={fact} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : !failureMessage ? (
        <EmptyState
          icon={Brain}
          title="まだ分析していません"
          description="AIがサイトを読み取り、解決する課題・提供価値・ターゲット顧客を整理します。内容は後から修正できます。"
        />
      ) : null}

      {isAdding ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium text-foreground">自分で追加する</h3>
          <FactForm
            action={addProductFact.bind(null, productId)}
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
