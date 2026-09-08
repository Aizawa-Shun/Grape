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

describe("FunnelView", () => {
  it("names the stages in plain Japanese rather than as funnel jargon", () => {
    render(<FunnelView productId="p1" funnel={funnel()} windowDays={30} />);

    expect(screen.getByText("中身を見てもらう")).toBeInTheDocument();
    expect(screen.queryByText("Engage")).not.toBeInTheDocument();
    expect(screen.queryByText(/ボトルネック/)).not.toBeInTheDocument();
  });

  it("shows every stage's count", () => {
    render(<FunnelView productId="p1" funnel={funnel()} windowDays={30} />);

    for (const count of ["200 人", "60 人", "40 人", "10 人"]) {
      expect(screen.getByText(count)).toBeInTheDocument();
    }
  });

  it("says how many people were lost at each step, not just the rate", () => {
    render(<FunnelView productId="p1" funnel={funnel()} windowDays={30} />);

    // 200 -> 60 is the drop the diagnosis is about; it was computed all along
    // and never shown.
    expect(screen.getByText("ここで 140 人が離れています")).toBeInTheDocument();
    expect(screen.getByText("ここで 20 人が離れています")).toBeInTheDocument();
  });

  it("marks the stage the arithmetic blamed", () => {
    render(<FunnelView productId="p1" funnel={funnel()} windowDays={30} />);

    expect(screen.getByText("いま一番の問題")).toBeInTheDocument();
  });

  it("refuses to draw rates it cannot stand behind on a cold start", () => {
    render(
      <FunnelView
        productId="p1"
        funnel={funnel({ totalSessions: 4, isColdStart: true, bottleneck: null })}
        windowDays={30}
      />,
    );

    expect(screen.getByText(/まだ判断できる人数が来ていません/)).toBeInTheDocument();
    expect(screen.queryByText("いま一番の問題")).not.toBeInTheDocument();
  });

  it("explains the two stages it cannot count instead of showing them as zero", () => {
    render(
      <FunnelView
        productId="p1"
        funnel={funnel({ hasKeyEvent: false, keyEventName: null, bottleneck: null })}
        windowDays={30}
      />,
    );

    expect(screen.getByText(/ゴールの操作を決めるまで数えられません/)).toBeInTheDocument();
    expect(screen.queryByText("40 人")).not.toBeInTheDocument();
  });

  it("does not divide by zero when nothing has happened", () => {
    render(
      <FunnelView
        productId="p1"
        funnel={funnel({
          totalSessions: 0,
          isColdStart: false,
          bottleneck: null,
          reachBySource: [],
          stages: [
            { stage: "visit", sessions: 0, comparedTo: null, rateFromPrevious: null },
            { stage: "engage", sessions: 0, comparedTo: 0, rateFromPrevious: null },
            { stage: "activate", sessions: 0, comparedTo: 0, rateFromPrevious: null },
            { stage: "retain", sessions: 0, comparedTo: 0, rateFromPrevious: null },
          ],
        })}
        windowDays={30}
      />,
    );

    expect(screen.getAllByText("0 人")).toHaveLength(4);
  });
});
