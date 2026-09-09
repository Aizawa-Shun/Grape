import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountMenu } from "./account-menu";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

/**
 * Guards a deletion, not a feature: アカウント設定 and プランと請求 used to
 * live here, each pointing at a page that only ever said "not built yet".
 * Grape has no user table and no billing, so those destinations describe a
 * product shape this app's own architecture rules out — this pins the menu
 * to real destinations only, so they cannot quietly come back.
 */
describe("AccountMenu", () => {
  it("offers only destinations that exist, not a promised account or billing page", async () => {
    render(<AccountMenu authEnabled={false} />);

    await userEvent.click(screen.getByRole("button", { name: /ローカル/ }));

    expect(screen.getByRole("menuitem", { name: /使い方ガイド/ })).toBeInTheDocument();
    expect(screen.queryByText("アカウント設定")).not.toBeInTheDocument();
    expect(screen.queryByText("プランと請求")).not.toBeInTheDocument();
    expect(screen.queryByText(/ヘルプ/)).not.toBeInTheDocument();
  });

  it("only offers to sign out when a password actually gates this instance", async () => {
    render(<AccountMenu authEnabled={false} />);
    await userEvent.click(screen.getByRole("button", { name: /ローカル/ }));
    expect(screen.queryByRole("menuitem", { name: /ログアウト/ })).not.toBeInTheDocument();
  });

  it("offers to sign out once a password is set", async () => {
    render(<AccountMenu authEnabled />);
    await userEvent.click(screen.getByRole("button", { name: /ローカル/ }));
    expect(screen.getByRole("menuitem", { name: /ログアウト/ })).toBeInTheDocument();
  });
});
