import { describe, expect, it } from "vitest";

import {
  ASSESSMENT_AXES,
  SaasAnalysisSchema,
  assessmentOf,
  assessmentRows,
  overallScore,
  weakestAxisKey,
  type SaasAnalysis,
  type SaasAssessment,
} from "./analysis";

function assessment(scores: Partial<Record<string, number>> = {}): SaasAssessment {
  return {
    clarity: { score: scores.clarity ?? 4, comment: "理由" },
    audience: { score: scores.audience ?? 3, comment: "理由" },
    differentiation: { score: scores.differentiation ?? 3, comment: "理由" },
    credibility: { score: scores.credibility ?? 2, comment: "理由" },
    action: { score: scores.action ?? 4, comment: "理由" },
    monetization: { score: scores.monetization ?? 2, comment: "理由" },
    summary: "総評",
    priority: "最優先で直すところ",
  };
}

describe("assessmentRows", () => {
  it("returns every axis, in the order the chart plots them", () => {
    const rows = assessmentRows(assessment());

    expect(rows.map((row) => row.key)).toEqual(ASSESSMENT_AXES.map((axis) => axis.key));
  });
});

describe("overallScore", () => {
  it("averages the axes to one decimal", () => {
    // (4 + 3 + 3 + 2 + 4 + 2) / 6 = 3.0
    expect(overallScore(assessment())).toBe(3);
    expect(overallScore(assessment({ clarity: 5 }))).toBe(3.2);
  });
});

describe("weakestAxisKey", () => {
  it("picks the lowest score", () => {
    expect(weakestAxisKey(assessment({ differentiation: 1 }))).toBe("differentiation");
  });

  /**
   * One axis gets the emphasis, never a set: the reason to highlight it is
   * that it is the next thing to work on, and "these three tie" is not
   * something anyone can act on.
   */
  it("breaks a tie by axis order, so the emphasis is always a single bar", () => {
    expect(weakestAxisKey(assessment({ credibility: 2, monetization: 2 }))).toBe("credibility");
  });
});

describe("assessmentOf", () => {
  const analysis = (value: unknown) => ({ assessment: value }) as unknown as SaasAnalysis;

  it("returns the assessment when one is there", () => {
    expect(assessmentOf(analysis(assessment()))).not.toBeNull();
  });

  /**
   * The column is a `$type<SaasAnalysis>()` cast over JSON with no revalidation
   * on read, so rows written before scoring existed claim at the type level to
   * have an assessment and do not. The product page has to keep rendering.
   */
  it("returns null for a row written before scoring existed", () => {
    expect(assessmentOf(analysis(undefined))).toBeNull();
  });

  it("returns null when an axis is missing rather than half-drawing the chart", () => {
    const partial = assessment() as unknown as Record<string, unknown>;
    delete partial.monetization;

    expect(assessmentOf(analysis(partial))).toBeNull();
  });
});

describe("SaasAnalysisSchema", () => {
  /**
   * Same rescue as `confidence` in extract.ts: a model that answers 7 to a
   * five-point question has understood it and mis-typed the answer, and
   * failing the whole analysis over that throws away a crawl and six other
   * scores that were fine.
   */
  it("clamps and rounds a score that lands outside 1-5", () => {
    const parsed = SaasAnalysisSchema.shape.assessment.shape.clarity.parse({
      score: 7,
      comment: "理由",
    });
    expect(parsed.score).toBe(5);

    expect(
      SaasAnalysisSchema.shape.assessment.shape.clarity.parse({ score: 3.4, comment: "理由" })
        .score,
    ).toBe(3);
  });
});
