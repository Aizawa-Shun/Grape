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
        // A pill rather than a slightly-rounded rectangle: at the small sizes
        // this renders at, a 2px corner radius look almost square and reads
        // as an unstyled default rather than a deliberate chip.
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
