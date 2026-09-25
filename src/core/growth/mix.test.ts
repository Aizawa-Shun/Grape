import { describe, expect, it } from "vitest";

import type { ContentPillar } from "@/db/schema";

import { apportion, normalizeShares, planWeek } from "./mix";

describe("apportion", () => {
  it("always sums to the total", () => {
    expect(apportion([1, 1, 1], 100).reduce((a, b) => a + b)).toBe(100);
    expect(apportion([40, 25, 15, 10, 10], 7).reduce((a, b) => a + b)).toBe(7);
  });

  it("gives the remainder to the largest fractions", () => {
    expect(apportion([1, 1, 1], 100)).toEqual([34, 33, 33]);
  });

  it("treats all-zero weights as equal", () => {
    expect(apportion([0, 0], 4)).toEqual([2, 2]);
  });
});

describe("normalizeShares", () => {
  it("turns a model's rough shares into integers summing to 100", () => {
    const pillars = normalizeShares([{ share: 50 }, { share: 30 }, { share: 30 }]);
    expect(pillars.reduce((s, p) => s + p.share, 0)).toBe(100);
  });
});

describe("planWeek", () => {
  const pillars: ContentPillar[] = [
    { name: "Educational", share: 60, description: "教える", postTypes: ["educational", "tutorial"] },
    { name: "Build in public", share: 40, description: "裏側", postTypes: ["build_in_public"] },
  ];

  it("allocates seven days by share", () => {
    const slots = planWeek(pillars, {});
    expect(slots).toHaveLength(7);
    expect(slots.filter((s) => s.pillar === "Educational")).toHaveLength(4);
    expect(slots.map((s) => s.day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("does not run the same pillar on consecutive days when the split allows it", () => {
    const pillarsByDay = planWeek(pillars, {}).map((s) => s.pillar);
    // 4 + 3 can alternate perfectly: E B E B E B E.
    expect(pillarsByDay.some((pillar, i) => i > 0 && pillar === pillarsByDay[i - 1])).toBe(false);
  });

  it("cycles topics and post types within a pillar", () => {
    const slots = planWeek(pillars, { Educational: ["A", "B"] }).filter((s) => s.pillar === "Educational");
    expect(slots.map((s) => s.topic)).toEqual(["A", "B", "A", "B"]);
    expect(slots.map((s) => s.postType)).toEqual(["educational", "tutorial", "educational", "tutorial"]);
  });
});
