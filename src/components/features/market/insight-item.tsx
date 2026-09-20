"use client";

import { useState, useTransition } from "react";
import { Check, ExternalLink, Pencil, Sparkles, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import { InsightForm } from "@/components/features/market/insight-form";
import {
  confirmInsight,
  editMarketInsight,
  removeInsight,
} from "@/server/actions/market-insights";
import type { MarketInsight } from "@/server/firebase/market-insights";

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium" }).format(date);
}

/**
 * 市場情報の1項目。
 *
 * 市場情報は時間とともに古くなるため、情報源URLと取得日時を必ず表示し、
 * 利用者が自分で一次情報を確認できるようにしている。
 */
export function InsightItem({ insight }: { insight: MarketInsight }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (isEditing) {
    return (
      <li className="rounded-lg border border-border bg-card p-4">
        <InsightForm
          action={editMarketInsight.bind(null, insight.productId, insight.id)}
          defaultValues={{
            category: insight.category,
            content: insight.content,
            recordType: insight.recordType,
            sourceUrl: insight.sourceUrl,
          }}
          submitLabel="保存する"
          onCancel={() => setIsEditing(false)}
          onSuccess={() => setIsEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <EvidenceBadge kind={insight.recordType} />
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {insight.source === "ai" ? (
            <>
              <Sparkles className="size-3.5" aria-hidden />
              AIの調査
            </>
          ) : (
            <>
              <User className="size-3.5" aria-hidden />
              自分で入力
            </>
          )}
        </span>
        {insight.confirmedAt ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="size-3.5" aria-hidden />
            確認済み
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-sm text-foreground">{insight.content}</p>

      {insight.evidence ? (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-medium">根拠:</span> {insight.evidence}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {insight.sourceUrl ? (
          <a
            href={insight.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-primary hover:underline"
          >
            <ExternalLink className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{insight.sourceTitle || insight.sourceUrl}</span>
          </a>
        ) : (
          <span>情報源なし(裏付け未取得)</span>
        )}
        <span>取得日: {formatDate(insight.capturedAt)}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1">
        {!insight.confirmedAt ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await confirmInsight(insight.productId, insight.id);
              })
            }
          >
            <Check className="size-4" aria-hidden />
            これで合っている
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
          <Pencil className="size-4" aria-hidden />
          修正する
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await removeInsight(insight.productId, insight.id);
            })
          }
        >
          <Trash2 className="size-4" aria-hidden />
          削除
        </Button>
      </div>
    </li>
  );
}
