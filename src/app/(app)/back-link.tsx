import Link from "next/link";

import { cx, focusRing } from "@/components/ui/cx";

/** The one-line way back above a page title, for screens reached from a list. */
export function BackLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className={cx(
        "w-fit rounded-xs text-xs text-text-muted transition-colors hover:text-text",
        focusRing,
      )}
    >
      <span aria-hidden="true">← </span>
      {children}
    </Link>
  );
}
