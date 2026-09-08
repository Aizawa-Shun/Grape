import type { ReactNode } from "react";

import { cx } from "./cx";

type Tone = "info" | "attention";

const TONES: Record<Tone, string> = {
  info: "border-border bg-surface-sunken text-text-muted",
  attention: "border-attention-border bg-attention-bg text-attention",
};

/** A standing note about the state of things — not a reaction to an action (that is Status). */
export function Callout({
  tone = "info",
  title,
  className,
  children,
}: {
  tone?: Tone;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <aside className={cx("rounded-md border px-3 py-2.5 text-sm", TONES[tone], className)}>
      {title && <p className="mb-1 font-medium">{title}</p>}
      {children}
    </aside>
  );
}
