import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FunnelResult } from "@/core/data/funnel";

import { FunnelView } from "./funnel-view";

function funnel(overrides: Partial<FunnelResult> = {}): FunnelResult {
  return {
    windowStart: new Date("2026-01-01T00:00:00Z"),
    windowEnd: new Date("2026-01-31T00:00:00Z"),
    keyEventName: "signup",
    coldStartMinSessions: 30,
    totalSessions: 200,
    reachBySource: [{ source: "google", sessions: 120 }],
    stages: [
      { stage: "visit", sessions: 200, comparedTo: null, rateFromPrevious: null },
      { stage: "engage", sessions: 60, comparedTo: 200, rateFromPrevious: 0.3 },
      { stage: "activate", sessions: 40, comparedTo: 60, rateFromPrevious: 0.667 },
      { stage: "retain", sessions: 10, comparedTo: 40, rateFromPrevious: 0.25 },
    ],
    isColdStart: false,
    hasKeyEvent: true,
    bottleneck: { stage: "engage", rateFromPrevious: 0.3, sessionsLost: 140 },
    ...overrides,
  };
}

/**
 * Asserts on what the view communicates, not on how it is marked up, so these
 * survive the redesign rather than having to be rewritten alongside it.
 */
describe("FunnelView", () => {
  it("shows every stage's session count", () => {
    render(<FunnelView productId="p1" funnel={funnel()} windowDays={30} />);

    for (const count of ["200", "60", "40", "10"]) {
      expect(screen.getAllByText(count).length).toBeGreaterThan(0);
    }
  });

  it("singles out the stage the arithmetic blamed", () => {
    render(<FunnelView productId="p1" funnel={funnel()} windowDays={30} />);

    expect(screen.getByText("ボトルネック")).toBeInTheDocument();
  });

  it("says the numbers cannot be trusted yet instead of showing rates on a cold start", () => {
    render(
      <FunnelView
        productId="p1"
        funnel={funnel({ totalSessions: 4, isColdStart: true, bottleneck: null })}
        windowDays={30}
      />,
    );

    expect(screen.getByText(/まずは配信経路/)).toBeInTheDocument();
    expect(screen.queryByText("ボトルネック")).not.toBeInTheDocument();
  });
});
