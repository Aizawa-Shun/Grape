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
 * The identity line names the signed-in account, which it can now do
 * truthfully: there are real accounts with real addresses.
 *
 * This used to link to an account-settings and a billing page, each just a
 * promise that name/email/password fields or a plan and an invoice would show
 * up eventually, and both were deleted because the architecture ruled them
 * out. Half of that reasoning has expired — there is a user table now — and
 * half has not: Grape is self-hosted and bills nobody, so プランと請求 stays
 * gone, and a test keeps it gone. The account screens are a separate piece of
 * work; this menu does not link to them until they exist, for the original
 * reason. A menu item that points at a future the architecture rules out
 * costs more trust than not having the item.
 */
const LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: "/guide", label: "使い方ガイド", icon: "book" },
];

/** Only what the menu shows. The user row also holds a password hash. */
export interface AccountSummary {
  displayName: string;
  email: string;
}

export function AccountMenu({ account }: { account: AccountSummary }) {
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
          className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold uppercase text-accent-fg"
        >
          {account.displayName.trim().charAt(0) || "G"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{account.displayName}</span>
          <span className="block truncate text-xs text-text-muted">{account.email}</span>
        </span>
        <span className={cx("text-text-muted transition-transform", open && "rotate-180")}>
          {ICONS.chevron}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="animate-popover absolute bottom-full left-0 right-0 z-20 mb-1 origin-bottom overflow-hidden rounded-md border border-border bg-surface py-1 shadow-lg"
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

          {/* Unconditional now: there is always an account to sign out of. */}
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
        </div>
      )}
    </div>
  );
}
