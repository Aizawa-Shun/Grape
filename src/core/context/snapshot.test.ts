import { describe, expect, it } from "vitest";

import type { Product, ProductContext } from "@/db/schema";

import { renderContextSnapshot } from "./snapshot";

const product: Product = {
  id: "p1",
  userId: "owner",
  url: "https://example.com",
  name: "Widget",
  keyEventName: "signup",
  setupStatus: "ready",
  setupError: null,
  setupClaimedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const context: ProductContext = {
  id: "c1",
  productId: "p1",
  version: 3,
  what: "ウィジェットを作る",
  who: "個人開発者",
  why: "手作業が遅いから",
  how: "ブラウザで完結する",
  sourcePages: ["https://example.com/pricing", "https://example.com/"],
  confidence: 0.8,
  gaps: [],
  analysis: null,
  primaryLanguage: "ja",
  editedByHuman: false,
  createdAt: new Date("2026-01-02T00:00:00Z"),
};

describe("renderContextSnapshot", () => {
  /**
   * The cache contract. Prompt caching is a prefix match, so anything that
   * varies between calls — a timestamp, a run id, an unsorted list — turns
   * every weekly re-diagnosis into a full-price call. This test is the guard.
   */
  it("is byte-identical across calls with the same rows", () => {
    expect(renderContextSnapshot(product, context)).toBe(renderContextSnapshot(product, context));
  });

  it("orders source pages deterministically regardless of input order", () => {
    const reversed = { ...context, sourcePages: [...context.sourcePages].reverse() };
    expect(renderContextSnapshot(product, reversed)).toBe(renderContextSnapshot(product, context));
  });

  it("contains nothing that changes over time", () => {
    const snapshot = renderContextSnapshot(product, context);
    // Timestamps are the classic silent cache invalidator; they are on the row
    // but must never reach the prefix.
    expect(snapshot).not.toContain("2026-01-01");
    expect(snapshot).not.toContain("2026-01-02");
    expect(snapshot).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("tells the reader whether a human has vetted the context", () => {
    expect(renderContextSnapshot(product, context)).toContain("人間の確認を経ていません");
    expect(renderContextSnapshot(product, { ...context, editedByHuman: true })).toContain(
      "人間が確認・修正済み",
    );
  });

  it("carries the fields downstream reasoning depends on", () => {
    const snapshot = renderContextSnapshot(product, context);
    for (const expected of [product.name, product.url, "signup", context.what, context.who, context.why, context.how]) {
      expect(snapshot).toContain(expected);
    }
    expect(snapshot).toContain("v3");
  });
});
