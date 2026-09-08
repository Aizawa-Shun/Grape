import type { ReactNode } from "react";

import { cx } from "./cx";

type Tone = "neutral" | "attention" | "positive" | "negative";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-sunken text-text-muted",
  attention: "bg-attention-bg text-attention border border-attention-border",
  positive: "text-positive",
  negative: "text-negative",
};

/**
 * One place for the four states this app expresses in colour. Before this the
 * same "needs attention" badge existed in three different amber pairings.
 */
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
