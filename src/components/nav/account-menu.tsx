"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";

import { cx, focusRing } from "@/components/ui/cx";

import { ICONS, type IconName } from "./icons";
import { useDismiss } from "./use-dismiss";

/**
 * Account-level concerns, deliberately a separate layer from the product nav
 * above it: nothing in here changes what you are looking at.
 *
 * Grape has no user table and no billing — it is one person on one machine
 * behind one password — so the identity line states the mode it is actually
 * running in rather than inventing a name and a subscription. The destinations
 * that do not exist yet say so on arrival; a menu that quietly leads nowhere
 * costs more trust than a missing item.
 */
const LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: "/account", label: "アカウント設定", icon: "user" },
  { href: "/billing", label: "プランと請求", icon: "card" },
  { href: "/guide", label: "使い方ガイド", icon: "book" },
  { href: "/help", label: "ヘルプ・お問い合わせ", icon: "help" },
];

export function AccountMenu({ authEnabled }: { authEnabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  function signOut() {
    startTransition(async () => {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cx(
          "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-surface",
          focusRing,
        )}
      >
        <span
          aria-hidden="true"
          className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-fg"
        >
          G
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">ローカル</span>
          <span className="block truncate text-xs text-text-muted">
            {authEnabled ? "パスワードで保護中" : "このパソコンのみ"}
          </span>
        </span>
        <span className={cx("text-text-muted transition-transform", open && "rotate-180")}>
          {ICONS.chevron}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 z-20 mb-1 overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              role="menuitem"
              onClick={close}
              className={cx(
                "flex items-center gap-2.5 px-3 py-2 text-sm text-text-muted hover:bg-surface-sunken hover:text-text",
                focusRing,
              )}
            >
              {ICONS[link.icon]}
              {link.label}
            </Link>
          ))}

          {authEnabled && (
            <>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                onClick={signOut}
                className={cx(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-text-muted hover:bg-surface-sunken hover:text-text disabled:opacity-50",
                  focusRing,
                )}
              >
                {ICONS.logout}
                {pending ? "ログアウトしています…" : "ログアウト"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
