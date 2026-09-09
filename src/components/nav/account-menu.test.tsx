import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountMenu } from "./account-menu";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

const ACCOUNT = { displayName: "しゅん", email: "shun@example.com" };

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

    await userEvent.click(screen.getByRole("button", { name: /しゅん/ }));

    expect(screen.getByRole("menuitem", { name: /使い方ガイド/ })).toBeInTheDocument();
    expect(screen.queryByText("プランと請求")).not.toBeInTheDocument();
  });

  /**
   * Signing out used to be conditional on a password being configured, because
   * without one there was no session to end. Every request now arrives as
   * somebody, including on a developer's machine, so a menu without this would
   * be a dead end.
   */
  it("always offers to sign out", async () => {
    render(<AccountMenu account={ACCOUNT} />);

    await userEvent.click(screen.getByRole("button", { name: /しゅん/ }));

    expect(screen.getByRole("menuitem", { name: /ログアウト/ })).toBeInTheDocument();
  });
});
