import { describe, expect, it } from "vitest";

import type { SaasAnalysis } from "./analysis";
import { contextFromAnalysis } from "./derive";
import { UNSTATED } from "./unstated";

function analysis(overrides: Partial<SaasAnalysis> = {}): SaasAnalysis {
  return {
    overview: { oneLiner: "オンラインでチェスを楽しめるWebサービス", description: "説明", category: "Gaming" },
    service: {
      what: { value: "ブラウザでチェスを対局できる", status: "confirmed" },
      who: { value: "チェスをプレイしたい人", status: "inferred" },
      problems: { items: ["対戦相手が見つからない"], status: "inferred" },
      valueProposition: { items: ["すぐに対局を始められる"], status: "inferred" },
      features: { items: ["オンライン対戦"], status: "confirmed" },
      usage: { value: "サイトを開いて対局を始める", status: "confirmed" },
    },
    targetUsers: { primary: ["チェスプレイヤー"], secondary: [], status: "inferred" },
    business: {
      pricing: { value: "未確認", status: "unknown" },
      model: { value: "未確認", status: "unknown" },
      audienceType: { value: "B2C", status: "inferred" },
      revenueSource: { value: "未確認", status: "unknown" },
    },
    market: {
      category: { value: "オンラインゲーム", status: "inferred" },
      industry: { value: "ゲーム", status: "inferred" },
      similarServices: { items: [], status: "unknown" },
    },
    insights: { strengths: [], differentiation: [], userNeeds: [], opportunities: [] },
    evidence: [
      { topic: "service.what", url: "https://example.com/", quote: "Play chess", reasoning: "理由" },
      { topic: "service.who", url: "https://example.com/rules", quote: "Rules", reasoning: "理由" },
    ],
    primaryLanguage: "ja",
    ...overrides,
  };
}

describe("contextFromAnalysis", () => {
  it("carries an inferred answer through as the plain answer", () => {
    // The point of the redesign: "誰向けか" is now answerable on a site that
    // never writes the words, and the inference is what the prompts see.
    expect(contextFromAnalysis(analysis()).who).toBe("チェスをプレイしたい人");
  });

  /**
   * intelligence/audit.ts compares against this exact literal to decide
   * whether a landing page states a value proposition at all. A
   * different-but-similar string would silently pass every site.
   */
  it("writes unknown claims as the exact sentinel the site audit compares against", () => {
    const source = analysis();
    source.service.who = { value: "未確認", status: "unknown" };

    expect(contextFromAnalysis(source).who).toBe(UNSTATED);
  });

  it("treats an empty value as unstated even when the model called it confirmed", () => {
    const source = analysis();
    source.service.what = { value: "   ", status: "confirmed" };

    expect(contextFromAnalysis(source).what).toBe(UNSTATED);
  });

  it("joins problems and value proposition into why, since a site may state either", () => {
    const why = contextFromAnalysis(analysis()).why;

    expect(why).toContain("対戦相手が見つからない");
    expect(why).toContain("すぐに対局を始められる");
  });

  it("collects the evidence URLs as the context's source pages, de-duplicated", () => {
    const source = analysis();
    source.evidence.push({
      topic: "service.features",
      url: "https://example.com/",
      quote: "q",
      reasoning: "r",
    });

    expect(contextFromAnalysis(source).evidenceUrls).toEqual([
      "https://example.com/",
      "https://example.com/rules",
    ]);
  });

  /**
   * What survives of the old "サイトに書かれていなかったこと" panel: not a line
   * per unanswered question, but the few that a site owner can act on.
   */
  it("reports only genuine unknowns as gaps", () => {
    const gaps = contextFromAnalysis(analysis()).gaps;

    expect(gaps).toContain("料金が明示されていません");
    expect(gaps.some((gap) => gap.includes("誰向け"))).toBe(false);
  });

  it("scores confirmed above inferred above unknown", () => {
    const allConfirmed = analysis();
    for (const claim of [
      allConfirmed.service.what,
      allConfirmed.service.who,
      allConfirmed.service.problems,
      allConfirmed.service.valueProposition,
      allConfirmed.service.features,
      allConfirmed.business.pricing,
    ]) {
      claim.status = "confirmed";
    }

    expect(contextFromAnalysis(allConfirmed).confidence).toBe(1);
    expect(contextFromAnalysis(analysis()).confidence).toBeLessThan(1);
    expect(contextFromAnalysis(analysis()).confidence).toBeGreaterThan(0);
  });
});
