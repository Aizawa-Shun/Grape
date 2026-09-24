import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { STAGE_UI } from "@/core/data/stages";
import type { ProductSnapshot } from "@/core/product/next-step";
import type { FunnelStage } from "@/db/schema";

export interface ProductListItem {
  id: string;
  name: string;
  url: string;
  setupStatus: "pending" | "ready" | "failed";
  /** The latest diagnosis's bottleneck, or null if it has never been diagnosed. */
  bottleneckStage: FunnelStage | null;
}

/** The snapshots the briefing is built from already carry everything a row shows. */
export function listItemsFrom(snapshots: ProductSnapshot[]): ProductListItem[] {
  return snapshots.map((snapshot) => ({
    ...snapshot.product,
    bottleneckStage: snapshot.latestBottleneckStage,
  }));
}

/**
 * Every registered service, one row each, with where it stands.
 *
 * Shared by the home page — where it sits under the briefing as context — and
 * /products, where it is the page. One component so the two can never
 * disagree about what "読み込めませんでした" or "詰まっています" means.
 */
export function ProductList({ products }: { products: ProductListItem[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border shadow-card">
      {products.map((product) => (
        <li key={product.id}>
          <Link
            href={`/products/${product.id}`}
            className="group flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm transition-colors hover:bg-surface-sunken"
          >
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium">{product.name}</span>
              <span className="truncate text-text-muted">{product.url}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {/* Setup state first: a product still being read has nothing to
                  diagnose yet, and one that failed to read needs attention
                  before its diagnosis does. */}
              {product.setupStatus === "pending" ? (
                <span className="text-xs text-text-muted">読み込み中…</span>
              ) : product.setupStatus === "failed" ? (
                <Badge tone="attention">読み込めませんでした</Badge>
              ) : product.bottleneckStage ? (
                <Badge tone="attention">{STAGE_UI[product.bottleneckStage].label}で詰まっています</Badge>
              ) : (
                <span className="text-xs text-text-muted">まだ調べていません</span>
              )}
              {/*
                Appears only on hover, so a row that is a link looks like one
                without the list becoming a column of arrows.
              */}
              <span
                aria-hidden="true"
                className="text-text-subtle opacity-0 transition-opacity group-hover:opacity-100"
              >
                →
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
