import type { ReactNode } from "react";

import { cx, focusRing } from "./cx";

/**
 * A collapsed detail, open only when asked for.
 *
 * Native `<details>` rather than state and a button: it needs no JavaScript,
 * so it works in a server component and survives before hydration, and the
 * browser gives correct semantics — expanded state, keyboard, find-in-page
 * opening it to reveal a match — for free.
 *
 * Used for evidence on the analysis page, where the point is that the backing
 * quote is always one click away but never in the way of reading the answer.
 */
export function Disclosure({
  summary,
  children,
  className,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={cx("group", className)}>
      <summary
        className={cx(
          "inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs text-text-subtle transition-colors hover:text-text",
          // Safari still paints its own triangle without this.
          "[&::-webkit-details-marker]:hidden",
          focusRing,
        )}
      >
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">
          ▸
        </span>
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
