"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";

import { cx, focusRing } from "@/components/ui/cx";
import type { NavProduct } from "@/core/product/nav";

import { ICONS } from "./icons";
import { useDismiss } from "./use-dismiss";

/**
 * Which product the funnel and the diagnosis are about.
 *
 * It sits at the top because it scopes everything below it — the alternative,
 * picking a product for the reader, means the one they wanted is the one they
 * cannot reach. With a single product it still renders, as a plain label: a
 * control that does nothing would be worse than none.
 */
export function ProductSwitcher({
  products,
  current,
  hrefFor,
}: {
  products: NavProduct[];
  current: NavProduct | null;
  /** Keeps the reader on the same view when they switch product. */
  hrefFor: (productId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  if (!current) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-text-muted">
        まだサービスがありません
      </p>
    );
  }

  if (products.length === 1) {
    return (
      <div className="rounded-md border border-border bg-surface px-3 py-2">
        <p className="truncate text-sm font-medium">{current.name}</p>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cx(
          "flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left",
          "hover:border-border-strong",
          focusRing,
        )}
      >
        <span className="truncate text-sm font-medium">{current.name}</span>
        <span className={cx("text-text-muted transition-transform", open && "rotate-180")}>
          {ICONS.chevron}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {products.map((product) => (
            <Link
              key={product.id}
              href={hrefFor(product.id)}
              role="menuitem"
              onClick={close}
              className={cx(
                "flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-surface-sunken",
                focusRing,
              )}
            >
              <span className="truncate">{product.name}</span>
              {product.id === current.id && (
                <span className="text-text-muted">{ICONS.check}</span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
