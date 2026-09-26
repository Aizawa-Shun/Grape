import { z } from "zod";

import type { Competitor, Confidence, Learning, MarketInsight, Segment } from "@/db/schema";

import { cleanList, COMMON_RULES, type AgentDeps } from "./shared";

/**
 * AudienceAnalyzer (spec §5): who to aim at, as hypotheses.
 *
 * Built from the market research, not from the product page alone, so that a
 * segment's problem, situation and words are the ones people were found using.
 * Each segment names the findings it rests on (by number, mapped to ids here),
 * and its confidence is counted from how many of those were read off a real
 * source — a segment nobody was found talking about is a guess, and says so.
 *
 * The first segment is the one the strategy aims at; everything after it is
 * what to try if the first turns out wrong.
 */

export const AudienceOutput = z.object({
  segments: z
    .array(
      z.object({
        name: z.string().describe("このセグメントを短く呼ぶ名前。例: 初めてMVPを出した個人開発者"),
        role: z.string().describe("役割・職種"),
        companySize: z.string().describe("会社・チームの規模。例: 1〜5人"),
        technicalLevel: z.string().describe("技術レベル。例: 高い（自分でコードを書く）"),
        situation: z.string().describe("その問題にぶつかる場面。いつ・何をしているとき。1文。"),
        problem: z.string().describe("抱えている問題。1文。"),
        pain: z.string().describe("それがなぜ痛いか。1文。"),
        motivation: z.string().describe("本当は何を成し遂げたいか。問題をなくす、の先。1文。"),
        currentSolutions: z.array(z.string()).describe("今どうやって凌いでいるか。1〜4件。"),
        fitReason: z.string().describe("なぜこのプロダクトに合うか。1〜2文。"),
        channels: z.array(z.string()).describe("どこで情報を集め、どこで話しているか。例: X, Reddit。1〜4件。"),
        keywords: z.array(z.string()).describe("この人が問題を検索するときの語句。3〜6件。指定言語で。"),
        xPhrases: z.array(z.string()).describe("この人がXに実際に書きそうな短いフレーズ。3〜6件。指定言語で。"),
        evidence: z.array(z.number().int()).describe("根拠にした調査結果の番号。"),
      }),
    )
    .describe("セグメントを2〜3件。狙うべき順に。互いに重ならないようにする。"),
});
export type AudienceOutput = z.infer<typeof AudienceOutput>;

export type SegmentDraft = Omit<Segment, "id" | "productId" | "runId" | "createdAt" | "rank">;

const SUFFIX = `

あなたはSaaSのマーケターである。市場調査と競合の情報から、「誰を狙うべきか」を仮説にする。
- 「開発者」「中小企業」で止めない。どんな場面（situation）でその問題にぶつかり、何を成し遂げたいか（motivation）、
  今どうやって凌いでいるか（currentSolutions）まで書く。
- 最初のセグメントが最優先。その人たちが、今いちばん困っていて、このプロダクトで確実に楽になり、見つけやすい人である。
- evidence には、根拠にした調査結果の番号を入れる。番号の無い事実は根拠にしない。調査に現れなかった人は、仮説として弱いと自覚する。
- pain・xPhrases は、調査にあるユーザー自身の言い回しを優先して使う。
- keywords と xPhrases は検索にそのまま使う。広すぎる一般語（"AI" だけ等）は入れない。
- 学び（実験の結果）が入力にあれば、それを尊重する。効かなかったと分かったセグメントを、根拠なく最優先にしない。${COMMON_RULES}`;

export interface AudienceAnalyzerInput {
  insights: Pick<MarketInsight, "id" | "kind" | "statement" | "userPhrases" | "grounded">[];
  competitors: Pick<Competitor, "name" | "targetAudience" | "weaknesses">[];
  learnings: Pick<Learning, "direction" | "statement">[];
}

/** high: three or more real sources; medium: at least one; low: none — a hypothesis from general knowledge. */
export function confidenceFor(evidence: Pick<MarketInsight, "grounded">[]): Confidence {
  const grounded = evidence.filter((insight) => insight.grounded).length;
  return grounded >= 3 ? "high" : grounded >= 1 ? "medium" : "low";
}

export function segmentsFromOutput(output: AudienceOutput, insights: AudienceAnalyzerInput["insights"]): SegmentDraft[] {
  return output.segments.slice(0, 3).map((segment) => {
    const cited = [...new Set(segment.evidence)].map((index) => insights[index]).filter((insight): insight is (typeof insights)[number] => Boolean(insight));
    return {
      name: segment.name.trim(),
      role: segment.role,
      companySize: segment.companySize,
      technicalLevel: segment.technicalLevel,
      situation: segment.situation,
      problem: segment.problem,
      pain: segment.pain,
      motivation: segment.motivation,
      currentSolutions: cleanList(segment.currentSolutions, 4),
      fitReason: segment.fitReason,
      channels: cleanList(segment.channels, 4),
      keywords: cleanList(segment.keywords, 6),
      xPhrases: cleanList(segment.xPhrases, 6),
      evidence: cited.map((insight) => insight.id),
      confidence: confidenceFor(cited),
      status: "hypothesis" as const,
    };
  });
}

export async function runAudienceAnalyzer(input: AudienceAnalyzerInput, deps: AgentDeps): Promise<SegmentDraft[]> {
  const user = [
    `検索語・フレーズの言語: ${deps.language}`,
    "",
    "# 市場調査の発見（番号で参照する）",
    input.insights
      .map(
        (i, index) =>
          `[${index}] (${i.kind}${i.grounded ? "" : "・出典なし"}) ${i.statement}${i.userPhrases.length ? `（ユーザーの言葉: ${i.userPhrases.slice(0, 3).join(" / ")}）` : ""}`,
      )
      .join("\n") || "(なし)",
    "",
    "# 競合と、その対象・弱み",
    input.competitors.map((c) => `- ${c.name}: ${c.targetAudience} / 弱み: ${c.weaknesses.join(" / ")}`).join("\n") || "(なし)",
    input.learnings.length
      ? `\n# 学び（実験の結果）\n${input.learnings.map((l) => `- [${l.direction === "works" ? "効いた" : l.direction === "fails" ? "効かなかった" : "未確定"}] ${l.statement}`).join("\n")}`
      : "",
  ].join("\n");

  const { value } = await deps.provider.completeStructured({
    kind: "research",
    schemaName: "audience_segments",
    schema: AudienceOutput,
    system: deps.system + SUFFIX,
    user,
  });
  return segmentsFromOutput(value, input.insights);
}
