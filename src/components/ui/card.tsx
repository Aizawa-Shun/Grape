import type { ReactNode } from "react";

import { cx } from "./cx";

type Element = "div" | "li" | "section" | "article";

interface Props {
  as?: Element;
  /** Lifts the card off the page for the one thing the reader should act on. */
  emphasis?: "default" | "attention";
  className?: string;
  children: ReactNode;
}

const EMPHASIS = {
  default: "border-border bg-surface shadow-card",
  attention: "border-attention-border bg-attention-bg shadow-card",
} as const;

export function Card({ as: Tag = "div", emphasis = "default", className, children }: Props) {
  return (
    <Tag className={cx("rounded-md border p-4", EMPHASIS[emphasis], className)}>{children}</Tag>
  );
}
