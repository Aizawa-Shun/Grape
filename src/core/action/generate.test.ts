import { describe, expect, it } from "vitest";

import { truncateToLimit } from "./generate";

describe("truncateToLimit", () => {
  it("leaves content under the limit untouched", () => {
    expect(truncateToLimit("short post", 280)).toBe("short post");
  });

  it("leaves content exactly at the limit untouched", () => {
    const exact = "a".repeat(280);
    expect(truncateToLimit(exact, 280)).toBe(exact);
  });

  it("cuts at the last word boundary and marks the cut with an ellipsis", () => {
    const content = "word ".repeat(60).trim(); // well over 280 chars, all whole words
    const result = truncateToLimit(content, 280);
    expect(result.length).toBeLessThanOrEqual(280);
    expect(result.endsWith("…")).toBe(true);
    // No word was sliced in half — the character right before the ellipsis is
    // either a full "word" or the boundary space was dropped.
    expect(result.slice(0, -1).trim().endsWith("word") || result === "…").toBe(true);
  });

  it("hard-cuts a single unbroken word that has no space to back off to", () => {
    const content = "x".repeat(400);
    const result = truncateToLimit(content, 280);
    expect(result.length).toBe(280);
    expect(result.endsWith("…")).toBe(true);
  });
});
