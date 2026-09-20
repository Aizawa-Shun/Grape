"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, Sparkles, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EvidenceBadge } from "@/components/ui/evidence-badge";
import { FactForm } from "@/components/features/products/fact-form";
import { confirmFact, editProductFact, removeFact } from "@/server/actions/product-facts";
import type { ProductFact } from "@/server/firebase/product-facts";

/**
 * Factの1項目。AIが出した内容を利用者が確認・修正・削除できるようにする。
 *
 * 「AIが言っただけの内容」と「利用者が確認した内容」を見た目で区別することが目的。
 */
export function FactItem({ fact }: { fact: ProductFact }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (isEditing) {
    return (
      <li className="rounded-lg border border-border bg-card p-4">
        <FactForm
          action={editProductFact.bind(null, fact.productId, fact.id)}
          defaultValues={{
            category: fact.category,
            content: fact.content,
            recordType: fact.recordType,
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
        <EvidenceBadge kind={fact.recordType} />
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {fact.source === "ai" ? (
            <>
              <Sparkles className="size-3.5" aria-hidden />
              AIの分析
            </>
          ) : (
            <>
              <User className="size-3.5" aria-hidden />
              自分で入力
            </>
          )}
        </span>
        {fact.confirmedAt ? (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="size-3.5" aria-hidden />
            確認済み
          </span>
        ) : null}
      </div>

      <p className="mt-2 text-sm text-foreground">{fact.content}</p>

      {fact.evidence ? (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-medium">根拠:</span> {fact.evidence}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1">
        {!fact.confirmedAt ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await confirmFact(fact.productId, fact.id);
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
              await removeFact(fact.productId, fact.id);
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
