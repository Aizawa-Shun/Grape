import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountMenu } from "./account-menu";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

const ACCOUNT = { displayName: "しゅん", email: "shun@example.com", role: "owner" } as const;
const MEMBER = { ...ACCOUNT, role: "member" } as const;

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: /しゅん/ }));
}

describe("AccountMenu", () => {
  it("names the signed-in account", async () => {
    render(<AccountMenu account={ACCOUNT} />);

    expect(screen.getByRole("button", { name: /しゅん/ })).toBeInTheDocument();
    expect(screen.getByText("shun@example.com")).toBeInTheDocument();
  });

  /**
   * Guards a deletion, not a feature. アカウント設定 and プランと請求 used to
   * live here, each pointing at a page that only ever said "not built yet".
   *
   * Half the original reasoning has expired: there is a user table now, so
   * account settings are a page Grape could honestly grow, and this test no
   * longer forbids it. The other half has not — Grape is self-hosted and bills
   * nobody, so a billing destination would describe a product shape this app's
   * own architecture still rules out.
   */
  it("does not offer a billing page, which this app has nothing to put behind", async () => {
    render(<AccountMenu account={ACCOUNT} />);

    await openMenu();

    expect(screen.getByRole("menuitem", { name: /使い方ガイド/ })).toBeInTheDocument();
    expect(screen.queryByText("プランと請求")).not.toBeInTheDocument();
  });

  /**
   * The items that came back, each because something real now sits behind it:
   * a users table, an invite endpoint, and a recorded spend estimate.
   */
  it.each([
    ["アカウント", "/account"],
    ["設定", "/settings"],
    ["招待", "/invites"],
    ["AI利用料", "/usage"],
    ["使い方ガイド", "/guide"],
  ])("offers %s", async (label, href) => {
    render(<AccountMenu account={ACCOUNT} />);

    await openMenu();

    expect(screen.getByRole("menuitem", { name: label })).toHaveAttribute("href", href);
  });

  /**
   * Not a second authorisation — the endpoint refuses a member on its own.
   * This keeps the menu from advertising a page that would only turn them away.
   */
  it("hides 招待 from a member, whom the endpoint would refuse anyway", async () => {
    render(<AccountMenu account={MEMBER} />);

    await openMenu();

    expect(screen.queryByRole("menuitem", { name: "招待" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "アカウント" })).toBeInTheDocument();
  });

  /**
   * Signing out used to be conditional on a password being configured, because
   * without one there was no session to end. Every request now arrives as
   * somebody, including on a developer's machine, so a menu without this would
   * be a dead end.
   */
  it("always offers to sign out", async () => {
    render(<AccountMenu account={ACCOUNT} />);

    await openMenu();

    expect(screen.getByRole("menuitem", { name: /ログアウト/ })).toBeInTheDocument();
  });
});
