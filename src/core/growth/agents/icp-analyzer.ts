import { z } from "zod";

import type { Competitor, MarketInsight } from "@/db/schema";

import { cleanList, COMMON_RULES, type AgentDeps } from "./shared";

/**
 * ICPAnalyzer: the two or three kinds of people most likely to use this now.
 *
 * Built from the market research rather than from the product page alone, so
 * that "pain" and "Xで使う言葉" come from how people actually talk. The
 * keywords and xPhrases it writes are what OpportunityFinder searches with —
 * which is why they are asked for in the audience's language and as the words
 * someone would type, not as marketing categories.
 */

export const IcpOutput = z.object({
  icps: z
    .array(
      z.object({
        name: z.string().describe("このICPを短く呼ぶ名前。例: 初めてMVPを出した個人開発者"),
        role: z.string().describe("役割・職種"),
        companySize: z.string().describe("会社・チームの規模。例: 1〜5人"),
        technicalLevel: z.string().describe("技術レベル。例: 高い（自分でコードを書く）"),
        problem: z.string().describe("抱えている問題。1文。"),
        pain: z.string().describe("それがなぜ痛いか。1文。"),
        goal: z.string().describe("達成したいこと。1文。"),
        buyingTrigger: z.string().describe("使い始めるきっかけになる出来事。例: MVPをリリースした直後"),
        currentAlternatives: z.array(z.string()).describe("今どうやって凌いでいるか。1〜4件。"),
        channels: z.array(z.string()).describe("どこで情報を集め、どこで話しているか。例: X, Reddit, Zenn。1〜4件。"),
        keywords: z.array(z.string()).describe("この人が問題を検索するときの語句。3〜6件。指定言語で。"),
        xPhrases: z
          .array(z.string())
          .describe("この人がXに実際に書きそうな短いフレーズ。例: 「〜するツールない？」「〜が面倒」。3〜6件。指定言語で。"),
      }),
    )
    .describe("ICPを2〜3件。見込みが高い順に。互いに重ならないようにする。"),
});
export type IcpOutput = z.infer<typeof IcpOutput>;
export type IcpDraft = IcpOutput["icps"][number];

const SUFFIX = `

あなたはB2B/B2CのSaaSマーケターである。市場調査と競合の情報から、
このプロダクトのIdeal Customer Profile（ICP）を作る。
- 「開発者」「中小企業」で止めない。状況（いつ・何をしている人か）まで書く。
- pain と xPhrases は、市場調査にあるユーザー自身の言い回しを優先して使う。
- keywords と xPhrases は、検索にそのまま使う。広すぎる一般語（"AI" だけ等）は入れない。${COMMON_RULES}`;

export interface IcpAnalyzerInput {
  insights: Pick<MarketInsight, "kind" | "statement" | "userPhrases">[];
  competitors: Pick<Competitor, "name" | "targetAudience" | "weaknesses">[];
}

export async function runIcpAnalyzer(input: IcpAnalyzerInput, deps: AgentDeps): Promise<IcpDraft[]> {
  const user = [
    `検索語・フレーズの言語: ${deps.language}`,
    "",
    "# 市場調査の発見",
    input.insights.map((i) => `- [${i.kind}] ${i.statement}${i.userPhrases.length ? `（ユーザーの言葉: ${i.userPhrases.join(" / ")}）` : ""}`).join("\n") ||
      "(なし)",
    "",
    "# 競合と、その対象・弱み",
    input.competitors.map((c) => `- ${c.name}: ${c.targetAudience} / 弱み: ${c.weaknesses.join(" / ")}`).join("\n") || "(なし)",
  ].join("\n");

  const { value } = await deps.provider.completeStructured({
    kind: "research",
    schemaName: "icps",
    schema: IcpOutput,
    system: deps.system + SUFFIX,
    user,
  });

  return value.icps.slice(0, 3).map((icp) => ({
    ...icp,
    currentAlternatives: cleanList(icp.currentAlternatives, 4),
    channels: cleanList(icp.channels, 4),
    keywords: cleanList(icp.keywords, 6),
    xPhrases: cleanList(icp.xPhrases, 6),
  }));
}
