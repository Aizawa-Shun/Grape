import { describe, expect, it } from "vitest";

import { apportion, normalizeShares } from "./mix";

describe("apportion", () => {
  it("always sums to the total, giving the remainder to the largest fractions", () => {
    expect(apportion([1, 1, 1], 100)).toEqual([34, 33, 33]);
    expect(apportion([40, 25, 15, 10, 10], 7).reduce((a, b) => a + b)).toBe(7);
  });

  it("treats all-zero weights as equal", () => {
    expect(apportion([0, 0], 4)).toEqual([2, 2]);
  });
});

describe("normalizeShares", () => {
  it("turns a model's rough shares into integers summing to 100", () => {
    expect(normalizeShares([{ share: 50 }, { share: 30 }, { share: 30 }]).reduce((s, p) => s + p.share, 0)).toBe(100);
  });
});
