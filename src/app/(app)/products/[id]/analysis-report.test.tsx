import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SaasAnalysis } from "@/core/context/analysis";

import { AnalysisReport } from "./analysis-report";

const text = (value: string, status: "confirmed" | "inferred" | "unknown" = "confirmed") => ({ value, status });
const list = (items: string[], status: "confirmed" | "inferred" | "unknown" = "inferred") => ({ items, status });
const axis = (score: number) => ({ score, comment: `${score}点の理由` });

function analysis(): SaasAnalysis {
  return {
    overview: { oneLiner: "オンラインでチェスを楽しめるWebサービス", description: "概要の段落", category: "Gaming" },
    service: {
      what: text("ブラウザでチェスを対局できる"),
      who: text("チェスをプレイしたい人", "inferred"),
      problems: list(["対戦相手が見つからない"]),
      valueProposition: list(["すぐに対局を始められる"]),
      features: list(["オンライン対戦"], "confirmed"),
      usage: text("サイトを開いて対局を始める"),
    },
    targetUsers: { primary: ["チェス初心者"], secondary: ["観戦したい人"], status: "inferred" },
    business: {
      pricing: text("料金ページが無い", "unknown"),
      model: text("無料", "inferred"),
      audienceType: text("B2C", "inferred"),
      revenueSource: text("広告の可能性", "unknown"),
    },
    market: {
      category: text("オンラインゲーム", "inferred"),
      industry: text("ゲーム", "inferred"),
      similarServices: list(["chess.comに近い", "lichessの代替になりうる"]),
      positioning: {
        xAxis: { label: "対象の習熟度", low: "初心者向け", high: "上級者向け" },
        yAxis: { label: "遊び方", low: "一人で学ぶ", high: "人と対戦" },
        self: { x: 1.5, y: 4 },
        others: [
          { name: "chess.com", x: 4, y: 4.5, note: "機能が多く上級者まで対応する" },
          { name: "lichess", x: 4.5, y: 4, note: "無料で上級者の利用が多い" },
        ],
        takeaway: "初心者が人と対戦する領域は競合が少ない。",
        status: "inferred",
      },
    },
    insights: {
      strengths: ["登録なしで遊べる"],
      weaknesses: ["運営者情報が無い"],
      differentiation: ["初心者に絞っている"],
      userNeeds: ["気軽に一局指したい"],
      opportunities: ["学習コンテンツの追加"],
      threats: ["大手の無料サービス"],
    },
    assessment: {
      clarity: axis(4),
      audience: axis(3),
      differentiation: axis(3),
      credibility: axis(2),
      action: axis(4),
      monetization: axis(1),
      summary: "総評",
      priority: "料金を書く",
    },
    evidence: [],
    primaryLanguage: "ja",
  };
}

describe("AnalysisReport", () => {
  it("leads with the one-liner and the overall score", () => {
    render(<AnalysisReport analysis={analysis()} />);

    expect(screen.getByText("オンラインでチェスを楽しめるWebサービス")).toBeInTheDocument();
    // (4 + 3 + 3 + 2 + 4 + 1) / 6 = 2.8
    expect(screen.getByRole("img", { name: /サイトの総合評価 2\.8/ })).toBeInTheDocument();
  });

  it("says how much of the report the site itself stated", () => {
    render(<AnalysisReport analysis={analysis()} />);

    expect(screen.getByText("この分析の確度")).toBeInTheDocument();
    expect(screen.getByText("14項目中")).toBeInTheDocument();
  });

  it("draws the positioning map, with every service also listed in words", () => {
    render(<AnalysisReport analysis={analysis()} />);

    expect(screen.getByRole("img", { name: /横軸は対象の習熟度/ })).toBeInTheDocument();
    expect(screen.getByText("このサービス")).toBeInTheDocument();
    expect(screen.getByText("機能が多く上級者まで対応する")).toBeInTheDocument();
    expect(screen.getByText("初心者が人と対戦する領域は競合が少ない。")).toBeInTheDocument();
  });

  it("lays the model's reading out as a SWOT matrix", () => {
    render(<AnalysisReport analysis={analysis()} />);

    for (const item of ["登録なしで遊べる", "運営者情報が無い", "学習コンテンツの追加", "大手の無料サービス"]) {
      expect(screen.getByText(item)).toBeInTheDocument();
    }
  });

  /** Analyses stored before the map and the W/T lists existed. */
  it("still renders an analysis written before the map existed", () => {
    const old = analysis() as unknown as {
      market: Record<string, unknown>;
      insights: Record<string, unknown>;
      assessment?: unknown;
    };
    delete old.market.positioning;
    delete old.insights.weaknesses;
    delete old.insights.threats;
    delete old.assessment;

    render(<AnalysisReport analysis={old as unknown as SaasAnalysis} />);

    expect(screen.getByText("chess.comに近い")).toBeInTheDocument();
    expect(screen.getByText(/読み直すと、類似サービスとの位置関係を図で表示します/)).toBeInTheDocument();
    expect(screen.getByText("登録なしで遊べる")).toBeInTheDocument();
  });
});
