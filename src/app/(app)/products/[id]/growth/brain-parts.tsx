import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cx } from "@/components/ui/cx";
import type { Confidence, Fact } from "@/db/schema";

import { CONFIDENCE_LABELS } from "./labels";

/**
 * The small pieces every Brain screen shares. The rule they carry: nothing
 * Grape shows is unlabelled — a fact says whether it is known or assumed and
 * where it came from, a segment says how much evidence it rests on.
 */

const BASIS_LABEL = { site: "サイトに記載", owner: "あなたの回答", inference: "Grapeの推測" } as const;

export function FactStatus({ fact }: { fact: Pick<Fact, "status" | "basis"> }) {
  return fact.status === "known" ? (
    <Badge tone="positive">{BASIS_LABEL[fact.basis]}</Badge>
  ) : (
    <Badge tone="attention">仮説</Badge>
  );
}

export function FactItem({ fact, showEvidence = true }: { fact: Fact; showEvidence?: boolean }) {
  const evidence = fact.evidence[0];
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <FactStatus fact={fact} />
        <span className={cx("text-sm", fact.status === "assumption" && "text-text-muted")}>{fact.text}</span>
      </div>
      {showEvidence && evidence && (
        <p className="pl-2 text-xs text-text-subtle">
          「{evidence.quote.length > 120 ? `${evidence.quote.slice(0, 120)}…` : evidence.quote}」
          <a href={evidence.url} target="_blank" rel="noopener noreferrer" className="ml-1 underline-offset-2 hover:underline">
            {safeHost(evidence.url)}
          </a>
        </p>
      )}
    </li>
  );
}

export function FactList({ facts, empty = "（まだありません）", showEvidence = true }: { facts: Fact[]; empty?: string; showEvidence?: boolean }) {
  if (facts.length === 0) return <p className="text-sm text-text-subtle">{empty}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {facts.map((fact, index) => (
        <FactItem key={`${fact.text}-${index}`} fact={fact} showEvidence={showEvidence} />
      ))}
    </ul>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return <Badge tone={confidence === "high" ? "positive" : confidence === "low" ? "attention" : "neutral"}>{CONFIDENCE_LABELS[confidence]}</Badge>;
}

/** A titled block of the Brain: what Grape thinks about one part of the marketing. */
export function BrainCard({
  eyebrow,
  title,
  children,
  footer,
  className,
}: {
  eyebrow: string;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-card", className)}>
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-medium tracking-wide text-text-subtle uppercase">{eyebrow}</p>
        {title && <h2 className="text-base font-semibold">{title}</h2>}
      </div>
      {children}
      {footer && <div className="mt-auto border-t border-border pt-2 text-xs">{footer}</div>}
    </section>
  );
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function formatDay(date: Date): string {
  return date.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
}
