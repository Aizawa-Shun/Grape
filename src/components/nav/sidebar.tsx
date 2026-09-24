"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx, focusRing } from "@/components/ui/cx";
import type { NavProduct } from "@/core/product/nav";

import { GrapeMark } from "@/components/ui/grape-mark";

import { AccountMenu, type AccountSummary } from "./account-menu";
import { ICONS, type IconName } from "./icons";
import { ProductSwitcher } from "./product-switcher";

/**
 * Two groups, split by how often they are touched.
 *
 * The top three are the loop someone runs repeatedly: what should I do, what
 * do the numbers say, what am I doing about it. The bottom two are the ground
 * that loop stands on and are visited occasionally. Keeping them in one flat
 * list would make the daily path harder to find, which is the whole cost of a
 * sidebar in the first place.
 */
interface Item {
  label: string;
  icon: IconName;
  /** Built per product, because the funnel and the tasks belong to one. */
  href: (productId: string | null) => string | null;
  match: (pathname: string, productId: string | null) => boolean;
  hint: string;
}

const LOOP: Item[] = [
  {
    label: "ホーム",
    icon: "home",
    href: () => "/",
    match: (pathname) => pathname === "/",
    hint: "いまの状況と、次にやること",
  },
  {
    label: "ファネル",
    icon: "funnel",
    href: (id) => (id ? `/products/${id}/funnel` : null),
    match: (pathname, id) => Boolean(id) && pathname === `/products/${id}/funnel`,
    hint: "どこで人が離れているか",
  },
  {
    label: "診断とタスク",
    icon: "tasks",
    href: (id) => (id ? `/products/${id}/tasks` : null),
    match: (pathname, id) => Boolean(id) && pathname === `/products/${id}/tasks`,
    hint: "なぜそうなっているかと、やること",
  },
];

const MANAGE: Item[] = [
  {
    label: "サービス",
    icon: "product",
    // No service selected yet means the list, not the home page: the list is
    // where registering one starts.
    href: (id) => (id ? `/products/${id}` : "/products"),
    match: (pathname, id) => Boolean(id) && pathname === `/products/${id}`,
    hint: "説明文と、読み取ったページ",
  },
  {
    label: "設定",
    icon: "settings",
    href: () => "/settings",
    match: (pathname) => pathname.startsWith("/settings"),
    hint: "AIの接続先や計測の設定",
  },
];

/** Which product the scoped views are about: the one in the URL, else the first. */
export function currentProductId(pathname: string, products: NavProduct[]): string | null {
  const fromPath = pathname.match(/^\/products\/([^/]+)/)?.[1];
  if (fromPath && products.some((product) => product.id === fromPath)) return fromPath;
  return products[0]?.id ?? null;
}

export function Sidebar({
  products,
  account,
  onNavigate,
}: {
  products: NavProduct[];
  account: AccountSummary;
  /** Lets the mobile drawer close itself when a link is followed. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const productId = currentProductId(pathname, products);
  const current = products.find((product) => product.id === productId) ?? null;

  function hrefForProduct(id: string): string {
    // Switching product keeps you on the same kind of view rather than
    // dumping you back at the top.
    if (pathname.startsWith("/settings")) return `/settings?product=${id}`;
    const suffix = pathname.match(/^\/products\/[^/]+\/(funnel|tasks)$/)?.[1];
    return suffix ? `/products/${id}/${suffix}` : `/products/${id}`;
  }

  return (
    <div className="flex h-full flex-col gap-5 p-3">
      <div className="flex flex-col gap-3 px-1 pt-1">
        <Link
          href="/"
          onClick={onNavigate}
          className={cx(
            "flex items-center gap-2 text-lg font-semibold tracking-tight",
            focusRing,
          )}
        >
          <GrapeMark size={22} />
          Grape
        </Link>
        <ProductSwitcher products={products} current={current} hrefFor={hrefForProduct} />
      </div>

      <nav aria-label="メイン" className="flex flex-1 flex-col gap-6">
        <Group
          items={LOOP}
          pathname={pathname}
          productId={productId}
          products={products}
          onNavigate={onNavigate}
        />
        <div className="border-t border-border" />
        <Group
          items={MANAGE}
          pathname={pathname}
          productId={productId}
          products={products}
          onNavigate={onNavigate}
        />
      </nav>

      <AccountMenu account={account} />
    </div>
  );
}

function Group({
  items,
  pathname,
  productId,
  products,
  onNavigate,
}: {
  items: Item[];
  pathname: string;
  productId: string | null;
  products: NavProduct[];
  onNavigate?: () => void;
}) {
  const openTasks = products.find((product) => product.id === productId)?.openTasks ?? 0;

  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const href = item.href(productId);
        const active = item.match(pathname, productId);
        const badge = item.label === "診断とタスク" && openTasks > 0 ? openTasks : null;

        // No product yet means the scoped views have nothing to point at.
        // Shown but inert, so the shape of the app is still legible on day one.
        if (!href) {
          return (
            <li key={item.label}>
              <span
                aria-disabled="true"
                title="サービスを登録すると使えます"
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-text-subtle opacity-60"
              >
                {ICONS[item.icon]}
                {item.label}
              </span>
            </li>
          );
        }

        return (
          <li key={item.label}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              title={item.hint}
              className={cx(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-surface font-medium text-text shadow-sm"
                  : "text-text-muted hover:bg-surface hover:text-text",
                focusRing,
              )}
            >
              {ICONS[item.icon]}
              <span className="flex-1 truncate">{item.label}</span>
              {badge !== null && (
                <span className="rounded-full bg-attention-bg px-1.5 text-xs font-medium text-attention">
                  {badge}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
