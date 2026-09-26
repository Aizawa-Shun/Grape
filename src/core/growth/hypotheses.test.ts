import { describe, expect, it } from "vitest";

import type { PostMetrics } from "@/db/schema";

import { evaluateHypothesis, type PostOutcome } from "./hypotheses";

const now = new Date("2026-09-10T00:00:00Z");

function outcome(hypothesisId: string | null, impressions: number | null, likes: number, visitors: number, signups = 0): PostOutcome {
  const metrics: PostMetrics | null =
    impressions === null
      ? null
      : { impressions, likes, replies: 0, reposts: 0, quotes: 0, bookmarks: 0, profileVisits: null, linkClicks: null, source: "manual" };
  return {
    post: { id: crypto.randomUUID(), hypothesisId, metrics, publishedAt: now },
    attribution: { visits: visitors, visitors, signups, activations: 0, paid: 0 },
  };
}

const many = (n: number, make: () => PostOutcome) => Array.from({ length: n }, make);

describe("evaluateHypothesis", () => {
  it("says nothing before there are enough posts on both sides", () => {
    const result = evaluateHypothesis("h1", [outcome("h1", 500, 10, 5), outcome("h2", 500, 5, 2)], true, now);
    expect(result).toMatchObject({ verdict: "inconclusive", confidence: "low", lift: null });
    expect(result.reason).toContain("3本以上");
  });

  it("supports a hypothesis whose posts bring clearly more people to the site per impression", () => {
    const result = evaluateHypothesis("h1", [...many(5, () => outcome("h1", 1000, 20, 30)), ...many(5, () => outcome("h2", 1000, 20, 10))], false, now);
    expect(result).toMatchObject({ verdict: "supported", lift: 2 });
    expect(result.clickRate).toBeCloseTo(0.03);
    expect(result.baseline.clickRate).toBeCloseTo(0.01);
    expect(result.confidence).toBe("high");
  });

  it("refutes one that clearly does worse", () => {
    expect(evaluateHypothesis("h1", [...many(4, () => outcome("h1", 1000, 5, 5)), ...many(4, () => outcome("h2", 1000, 20, 20))], false, now).verdict).toBe(
      "refuted",
    );
  });

  it("calls a small difference inconclusive, and says why", () => {
    const result = evaluateHypothesis("h1", [...many(4, () => outcome("h1", 1000, 10, 11)), ...many(4, () => outcome("h2", 1000, 10, 10))], false, now);
    expect(result.verdict).toBe("inconclusive");
    expect(result.reason).toContain("25%以上の差がない");
  });

  it("prefers signups over clicks once there are enough visitors to compare them", () => {
    const result = evaluateHypothesis(
      "h1",
      [...many(4, () => outcome("h1", 1000, 10, 10, 3)), ...many(4, () => outcome("h2", 1000, 10, 10, 1))],
      true,
      now,
    );
    expect(result.verdict).toBe("supported");
    expect(result.reason).toContain("訪問から登録");
  });

  it("does not pretend to know without impressions", () => {
    const result = evaluateHypothesis("h1", [...many(4, () => outcome("h1", null, 0, 1)), ...many(4, () => outcome("h2", null, 0, 0))], false, now);
    expect(result.verdict).toBe("inconclusive");
    expect(result.reason).toContain("Xの数字の取り込み");
  });
});
