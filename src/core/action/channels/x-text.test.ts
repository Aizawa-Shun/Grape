import { describe, expect, it } from "vitest";

import { fitToX, xWeightedLength, X_WEIGHTED_LIMIT } from "./x-text";

describe("xWeightedLength", () => {
  it("counts Latin text one per character", () => {
    expect(xWeightedLength("hello world")).toBe(11);
  });

  /** The bug this module exists for: `.length` let 200 Japanese characters through. */
  it("counts Japanese characters as two", () => {
    expect(xWeightedLength("こんにちは")).toBe(10);
    expect(xWeightedLength("あ".repeat(140))).toBe(X_WEIGHTED_LIMIT);
  });

  it("counts every URL as 23 however long it is", () => {
    const url = "https://example.com/very/long/path?utm_source=x&utm_medium=social&utm_campaign=grape&utm_content=0f7c";
    expect(xWeightedLength(`見て ${url}`)).toBe(4 + 1 + 23);
  });
});

describe("fitToX", () => {
  it("leaves text that fits alone", () => {
    expect(fitToX("short")).toBe("short");
  });

  it("cuts Japanese text to the weighted limit, leaving room for a link", () => {
    const fitted = fitToX("あ".repeat(200), 24);
    expect(xWeightedLength(fitted)).toBeLessThanOrEqual(X_WEIGHTED_LIMIT - 24);
    expect(fitted.endsWith("…")).toBe(true);
  });

  it("prefers a sentence break when one is close", () => {
    const text = `${"い".repeat(110)}。${"う".repeat(60)}`;
    expect(fitToX(text)).toBe(`${"い".repeat(110)}。`);
  });
});
