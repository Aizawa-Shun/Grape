"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import type { Opportunity } from "@/db/schema";

import { ACTION_LABELS, INTENT_LABELS, SOURCE_LABELS } from "./labels";
import { send } from "./request";

/**
 * One conversation the agent found, with the number and — always — the
 * reasons behind it (spec §12, §34). A relevance with no "why" is never
 * shown; OpportunityFinder does not keep one.
 */
export function OpportunityCard({ opportunity, productId }: { opportunity: Opportunity; productId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"reply" | "dismiss" | null>(null);

  function act(kind: "reply" | "dismiss") {
    setBusy(kind);
    setError(null);
    startTransition(async () => {
      const result = await send(`/api/growth/opportunities/${opportunity.id}/${kind}`, "POST");
      setBusy(null);
      if (!result.ok) return setError(result.error);
      if (kind === "reply") router.push(`/products/${productId}/growth/posts#drafts`);
      router.refresh();
    });
  }

  const hot = opportunity.intent === "seeking_solution" && opportunity.relevance >= 80;

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={hot ? "attention" : "neutral"}>{hot ? "見込みが高い" : INTENT_LABELS[opportunity.intent]}</Badge>
        <span className="text-xs text-text-muted">
          {SOURCE_LABELS[opportunity.source]} ・ {opportunity.author}
          {opportunity.icpName ? ` ・ ${opportunity.icpName}` : ""}
        </span>
        <span className="ml-auto text-sm font-semibold tabular-nums">関連度 {opportunity.relevance}%</span>
      </div>

      <blockquote className="border-l-2 border-border-strong pl-3 text-sm whitespace-pre-line text-text">
        {opportunity.text.length > 420 ? `${opportunity.text.slice(0, 420)}…` : opportunity.text}
      </blockquote>

      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-text-muted">なぜ見込みだと判断したか</p>
        <ul className="flex flex-col gap-0.5 text-xs text-text-muted">
          {opportunity.reasons.map((reason) => (
            <li key={reason}>・ {reason}</li>
          ))}
        </ul>
        <p className="text-xs text-text-muted">
          おすすめの動き: <span className="font-medium text-text">{ACTION_LABELS[opportunity.recommendedAction]}</span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <a href={opportunity.url} target="_blank" rel="noopener noreferrer" className="text-xs text-text-muted underline-offset-2 hover:underline">
          元の投稿を開く
        </a>
        <span className="flex-1" />
        {opportunity.status === "drafted" ? (
          <Link href={`/products/${productId}/growth/posts#drafts`} className="text-xs font-medium underline-offset-2 hover:underline">
            返信案を見る
          </Link>
        ) : (
          <>
            <Button size="sm" variant="ghost" loading={pending && busy === "dismiss"} onClick={() => act("dismiss")}>
              見送る
            </Button>
            <Button size="sm" variant="primary" loading={pending && busy === "reply"} onClick={() => act("reply")}>
              返信案を作る
            </Button>
          </>
        )}
      </div>
      {error && <Status tone="error">{error}</Status>}
    </li>
  );
}
