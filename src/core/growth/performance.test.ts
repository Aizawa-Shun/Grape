import { describe, expect, it } from "vitest";

import type { MarketingStrategy, PostMetrics, PostType } from "@/db/schema";

import { reweightPillars, typeStats, type PostPerformance } from "./performance";

function perf(postType: PostType, impressions: number, likes: number, visits: number, signups: number): PostPerformance {
  const metrics: PostMetrics = {
    impressions,
    likes,
    replies: 0,
    reposts: 0,
    quotes: 0,
    bookmarks: 0,
    profileVisits: 0,
    linkClicks: null,
    source: "manual",
  };
  return {
    post: { id: crypto.randomUUID(), postType, pillar: null, hook: "", text: "", metrics, publishedAt: new Date() },
    attribution: { visits, visitors: visits, signups },
  };
}

describe("typeStats", () => {
  it("ranks by engagement, clicks and signups together, not CTR alone", () => {
    const stats = typeStats([
      // High click rate, nobody signs up.
      perf("feature", 100, 1, 20, 0),
      perf("feature", 100, 1, 20, 0),
      // Fewer clicks, but they convert.
      perf("case_study", 100, 5, 10, 3),
      perf("case_study", 100, 5, 10, 3),
    ]);
    expect(stats[0].postType).toBe("case_study");
    expect(stats.find((s) => s.postType === "feature")!.clickRate).toBeCloseTo(0.2);
  });

  it("pulls a type with one lucky post toward the average", () => {
    const stats = typeStats([perf("contrarian", 100, 50, 30, 5), perf("educational", 100, 5, 5, 1), perf("educational", 100, 5, 5, 1)]);
    const lucky = stats.find((s) => s.postType === "contrarian")!;
    expect(lucky.score).toBeLessThan(1);
  });

  it("reports rates as null, not zero, when nothing was shown", () => {
    const [row] = typeStats([perf("question", 0, 0, 0, 0)]);
    expect(row.engagementRate).toBeNull();
  });
});

describe("reweightPillars", () => {
  const strategy: Pick<MarketingStrategy, "pillars"> = {
    pillars: [
      { name: "Educational", share: 50, description: "", postTypes: ["educational"] },
      { name: "Product", share: 50, description: "", postTypes: ["feature"] },
    ],
  };

  it("refuses to learn from too few posts", () => {
    expect(reweightPillars(strategy, typeStats([perf("educational", 100, 5, 5, 1)]))).toBeNull();
  });

  it("moves share toward what worked, within bounds, still summing to 100", () => {
    const stats = typeStats([
      perf("educational", 100, 10, 10, 3),
      perf("educational", 100, 10, 10, 3),
      perf("feature", 100, 1, 1, 0),
      perf("feature", 100, 1, 1, 0),
    ]);
    const pillars = reweightPillars(strategy, stats)!;
    const educational = pillars.find((p) => p.name === "Educational")!.share;
    expect(educational).toBeGreaterThan(50);
    expect(pillars.find((p) => p.name === "Product")!.share).toBeGreaterThanOrEqual(5);
    expect(pillars.reduce((s, p) => s + p.share, 0)).toBe(100);
  });
});
