import Link from "next/link";
import type { ReactNode } from "react";

import { cx, focusRing } from "./cx";

interface Props {
  href: string;
  className?: string;
  children: ReactNode;
}

/**
 * An inline link that reads as prose rather than as a control.
 *
 * The logged-out pages were the reason: each offered exactly one thing to do
 * and no way to reach the other, so someone who landed on the wrong one had
 * only the address bar. Underlined rather than merely coloured, because the
 * sentences it sits in are already muted text.
 */
export function TextLink({ href, className, children }: Props) {
  return (
    <Link
      href={href}
      className={cx(
        "rounded-xs font-medium text-text underline underline-offset-2 hover:text-text-muted",
        focusRing,
        className,
      )}
    >
      {children}
    </Link>
  );
}
