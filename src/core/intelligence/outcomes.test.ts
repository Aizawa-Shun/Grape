import { describe, expect, it } from "vitest";

import type { FunnelResult } from "@/core/data/funnel";

import { sessionsForStage } from "./outcomes";

function fakeFunnel(overrides: Partial<FunnelResult> = {}): FunnelResult {
  return {
    windowStart: new Date("2026-01-01T00:00:00Z"),
    windowEnd: new Date("2026-01-08T00:00:00Z"),
    keyEventName: "signup",
    coldStartMinSessions: 30,
    totalSessions: 100,
    reachBySource: [],
    stages: [
      { stage: "visit", sessions: 100, comparedTo: null, rateFromPrevious: null },
      { stage: "engage", sessions: 40, comparedTo: 100, rateFromPrevious: 0.4 },
      { stage: "activate", sessions: 10, comparedTo: 40, rateFromPrevious: 0.25 },
      { stage: "retain", sessions: 3, comparedTo: 10, rateFromPrevious: 0.3 },
    ],
    isColdStart: false,
    hasKeyEvent: true,
    bottleneck: null,
    ...overrides,
  };
}

describe("sessionsForStage", () => {
  it("reads reach as the funnel's total sessions, which has no stage row of its own", () => {
    const funnel = fakeFunnel({ totalSessions: 250 });
    expect(sessionsForStage(funnel, "reach")).toBe(250);
  });

  it("reads any of the sequential stages from the matching row", () => {
    const funnel = fakeFunnel();
    expect(sessionsForStage(funnel, "visit")).toBe(100);
    expect(sessionsForStage(funnel, "engage")).toBe(40);
    expect(sessionsForStage(funnel, "activate")).toBe(10);
    expect(sessionsForStage(funnel, "retain")).toBe(3);
  });
});
