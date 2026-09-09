"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { cx, focusRing } from "@/components/ui/cx";
import type { NavProduct } from "@/core/product/nav";

import { ICONS } from "./icons";
import type { AccountSummary } from "./account-menu";
import { Sidebar } from "./sidebar";

/**
 * A fixed rail on a wide screen; a drawer on a narrow one.
 *
 * The drawer, rather than a bottom bar, because the nav carries a product
 * switcher and an account menu that a five-icon bar cannot hold — and because
 * this is a tool people mostly open on a laptop and only glance at on a phone.
 */
export function AppShell({
  products,
  account,
  children,
}: {
  products: NavProduct[];
  account: AccountSummary;
  children: ReactNode;
}) {
  const pathname = usePathname();
  // Derived rather than an effect: the drawer is open only for the route it
  // was opened on, so *any* navigation closes it — a tapped link, the back
  // gesture, a redirect — without a render pass that first shows it open on
  // the new page.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const setOpen = (next: boolean) => setOpenedOn(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-border bg-surface-sunken lg:block">
        <Sidebar products={products} account={account} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface/80 px-3 py-2 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="メニューを開く"
            aria-expanded={open}
            className={cx("rounded-md p-2 text-text-muted hover:bg-surface-sunken", focusRing)}
          >
            {ICONS.menu}
          </button>
          <span className="text-sm font-semibold tracking-tight">Grape</span>
        </header>

        <main className="flex flex-1 flex-col">{children}</main>
      </div>

      {open && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            type="button"
            aria-label="メニューを閉じる"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-text/20"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-border bg-surface-sunken shadow-xl">
            <div className="flex justify-end p-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="メニューを閉じる"
                className={cx("rounded-md p-2 text-text-muted hover:bg-surface", focusRing)}
              >
                {ICONS.close}
              </button>
            </div>
            <Sidebar products={products} account={account} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
