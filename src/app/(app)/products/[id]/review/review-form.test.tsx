import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReviewForm } from "./review-form";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const FIELDS = {
  what: "ブラウザでチェスを対局できるサービスである",
  who: "チェスを覚えたい初心者と推測される",
  why: "対戦相手がすぐ見つからない",
  how: "サイトを開いて対局する",
};

function mockFetch() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderForm(overrides: Partial<Parameters<typeof ReviewForm>[0]> = {}) {
  return render(
    <ReviewForm
      productId="p1"
      initialName="Cheeeess"
      initialUrl="https://cheeeess.com/"
      initialFields={FIELDS}
      notes={{ source: "ai", blank: [], guessed: ["who", "why"] }}
      {...overrides}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
  refresh.mockClear();
});

describe("ReviewForm", () => {
  it("says which fields the AI filled in without the site stating them", () => {
    renderForm();

    expect(screen.getByText("AIがページを読み取って下書きしました")).toBeInTheDocument();
    expect(screen.getByText("想定顧客、解決する課題")).toBeInTheDocument();
  });

  it("lists fields the rule-based reading left blank", () => {
    renderForm({
      initialFields: { ...FIELDS, who: "" },
      notes: { source: "rules", blank: ["who"], guessed: [] },
    });

    expect(screen.getByText(/空欄にしている項目/)).toBeInTheDocument();
    // An empty required field keeps the form from saving until it is filled.
    expect(screen.getByRole("button", { name: "この内容で保存する" })).toBeDisabled();
  });

  it("saves the name and the four fields, then goes to the product page", async () => {
    const fetchMock = mockFetch();
    renderForm();

    const name = screen.getByLabelText("サービス名");
    await userEvent.clear(name);
    await userEvent.type(name, "チェス部");
    await userEvent.click(screen.getByRole("button", { name: "この内容で保存する" }));

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/products/p1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "チェス部" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/products/p1/context",
      expect.objectContaining({ method: "PUT", body: JSON.stringify(FIELDS) }),
    );
    expect(push).toHaveBeenCalledWith("/products/p1");
  });

  it("does not patch the product when only the description changed", async () => {
    const fetchMock = mockFetch();
    renderForm();

    await userEvent.click(screen.getByRole("button", { name: "この内容で保存する" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/products/p1/context");
  });

  /**
   * The four fields describe the site that was read, so saving them against a
   * different address would pin a description to a site it was never about.
   */
  it("re-reads the site instead of saving the fields when the URL changes", async () => {
    const fetchMock = mockFetch();
    renderForm();

    const url = screen.getByLabelText("URL");
    await userEvent.clear(url);
    await userEvent.type(url, "https://new.example/");
    expect(screen.getByLabelText("想定顧客")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "保存して読み直す" }));

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/products/p1",
      "/api/products/p1/reread",
    ]);
    expect(refresh).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("stops and shows the reason when the address clashes with another service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: "そのURLは別のサービスとして登録済みです。" }),
      }),
    );
    renderForm();

    const url = screen.getByLabelText("URL");
    await userEvent.clear(url);
    await userEvent.type(url, "https://other.example/");
    await userEvent.click(screen.getByRole("button", { name: "保存して読み直す" }));

    expect(await screen.findByText("そのURLは別のサービスとして登録済みです。")).toBeInTheDocument();
  });

  it("does not call an empty reading a draft", () => {
    renderForm({
      initialFields: { what: "", who: "", why: "", how: "" },
      notes: { source: "rules", blank: ["what", "who", "why", "how"], guessed: [] },
    });

    expect(screen.getByText("ページから内容を読み取れませんでした")).toBeInTheDocument();
    expect(screen.queryByText(/下書きしました/)).not.toBeInTheDocument();
  });
});
