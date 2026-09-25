import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SaasAssessment } from "@/core/context/analysis";

import { AssessmentChart } from "./assessment-chart";

function assessment(overrides: Partial<Record<string, number>> = {}): SaasAssessment {
  return {
    clarity: { score: overrides.clarity ?? 4, comment: "トップに一文で説明がある。" },
    audience: { score: overrides.audience ?? 3, comment: "誰向けかは推測になる。" },
    differentiation: { score: overrides.differentiation ?? 3, comment: "比較の記述が無い。" },
    credibility: { score: overrides.credibility ?? 2, comment: "実績の記載が見当たらない。" },
    action: { score: overrides.action ?? 4, comment: "対局ボタンが目立つ位置にある。" },
    monetization: { score: overrides.monetization ?? 1, comment: "料金ページが存在しない。" },
    summary: "説明は伝わるが、信じる手がかりが薄い。",
    priority: "料金の扱いを1行でよいので書く。",
  };
}

describe("AssessmentChart", () => {
  it("shows the overall score and every axis with its own number", () => {
    render(<AssessmentChart assessment={assessment()} />);

    // (4 + 3 + 3 + 2 + 4 + 1) / 6 = 2.8
    expect(screen.getByText(/総合 2\.8 \/ 5/)).toBeInTheDocument();
    expect(screen.getByText("価値の明確さ")).toBeInTheDocument();
    expect(screen.getByText("収益への道筋")).toBeInTheDocument();
  });

  /**
   * The chart has to be readable without seeing it: the bar is decorative, so
   * every score is also text, and the word beside it means the level never
   * rests on bar length alone.
   */
  it("writes each score as text, not only as a bar", () => {
    render(<AssessmentChart assessment={assessment()} />);

    expect(screen.getByText("ほぼ手つかず")).toBeInTheDocument();
    expect(screen.getAllByText("よくできている")).toHaveLength(2);
  });

  it("marks the weakest axis in words, so the emphasis is not colour alone", () => {
    render(<AssessmentChart assessment={assessment()} />);

    const weakest = screen.getByText("収益への道筋").closest("dt");
    expect(weakest).not.toBeNull();
    expect(within(weakest as HTMLElement).getByText("最優先")).toBeInTheDocument();
    expect(screen.getAllByText("最優先")).toHaveLength(1);
  });

  it("moves the emphasis when a different axis scores lowest", () => {
    render(<AssessmentChart assessment={assessment({ monetization: 5, clarity: 1 })} />);

    const weakest = screen.getByText("価値の明確さ").closest("dt");
    expect(within(weakest as HTMLElement).getByText("最優先")).toBeInTheDocument();
  });

  it("carries the model's reasoning and the one thing to fix first", () => {
    render(<AssessmentChart assessment={assessment()} />);

    expect(screen.getByText("料金ページが存在しない。")).toBeInTheDocument();
    expect(screen.getByText("説明は伝わるが、信じる手がかりが薄い。")).toBeInTheDocument();
    expect(screen.getByText(/料金の扱いを1行でよいので書く。/)).toBeInTheDocument();
  });
});
