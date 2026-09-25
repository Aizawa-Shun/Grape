import { z } from "zod";

import { INSIGHT_KINDS, type InsightKind, type SourceRef } from "@/db/schema";

import type { ConversationCandidate, ConversationSource } from "../sources/types";
import type { WebResearcher, WebResearchResult } from "../sources/web";
import { cleanList, COMMON_RULES, groundedSources, renderSources, type AgentDeps } from "./shared";

/**
 * MarketResearcher: how the market talks about the problem this product solves.
 *
 * The spec's emphasis is the thing this is built around — not a market-size
 * slide, but the words people use for their own problem, because those are the
 * words a post has to use to be recognised. So the output leads with
 * `userPhrases`, and every insight carries the sources it was read from.
 *
 * Three passes: plan what to search for; search (the open web when this
 * account has web search, Hacker News always); then structure. A finding that
 * cites nothing fetched in this run is still kept, marked ungrounded, because
 * a model's general knowledge of a market is worth something — as long as it
 * is never shown as though somebody had checked it.
 */

export const QueryPlan = z.object({
  queries: z.array(z.string()).describe("ユーザーが問題を検索するときの語句を4〜6件。指定言語で。"),
  englishQueries: z
    .array(z.string())
    .describe("英語圏の開発者コミュニティ（Hacker News）で同じ問題を探すための英語の語句を3〜5件。2〜4語の短いもの。"),
});
export type QueryPlan = z.infer<typeof QueryPlan>;

export const MarketResearchOutput = z.object({
  insights: z
    .array(
      z.object({
        kind: z
          .enum(INSIGHT_KINDS)
          .describe(
            "pain=悩み / phrase=ユーザーがよく使う表現 / complaint=既存手段への不満 / desired_feature=求められている機能 / " +
              "unmet_need=満たされていないニーズ / trend=話題になっているテーマ / gap=まだ訴求されていない領域",
          ),
        statement: z.string().describe("発見を1〜2文で。である調。"),
        userPhrases: z
          .array(z.string())
          .describe("ユーザー自身の言い回しを0〜4件。原文の言語のまま、短く引用する。作らない。"),
        sourceUrls: z.array(z.string()).describe("根拠にしたURL。下の「取得したソース」にあるものだけ。無ければ空。"),
      }),
    )
    .describe("市場調査の発見を8〜14件。pain・phrase・complaintを中心に、各種類を偏らせない。"),
});
export type MarketResearchOutput = z.infer<typeof MarketResearchOutput>;

export interface MarketFinding {
  kind: InsightKind;
  statement: string;
  userPhrases: string[];
  sources: SourceRef[];
  grounded: boolean;
}

export interface MarketResearchResult {
  findings: MarketFinding[];
  plan: QueryPlan;
  webUsed: boolean;
  sourcesRead: number;
}

const PLAN_SUFFIX = `

あなたは市場調査の担当者である。このプロダクトが解決する問題について、
見込みユーザーが自分の言葉で問題を語っている場所を探すための検索語を決める。
- プロダクト名や機能名ではなく「問題」「困りごと」「やりたいこと」の言葉にする。
- 競合名・代替手段の名前を含む語句を1〜2件入れてよい。${COMMON_RULES}`;

export const WEB_INSTRUCTIONS = `You are a market researcher for a small software product. Search the public web
— Reddit, X, Product Hunt, Hacker News, GitHub issues, blogs, forums, and review sites —
for how real users describe the problem the product solves.

Report back as a plain research memo, citing sources:
- The pains and frustrations people describe, in their own words (quote them).
- What they complain about in existing tools and alternatives.
- Features they ask for, needs nobody seems to meet, and themes that are trending.
- Which communities these conversations happen in.

Quote real text. Do not invent quotes, numbers, or products.`;

const STRUCTURE_SUFFIX = `

あなたは市場調査の担当者である。検索結果とコミュニティの投稿から、
このプロダクトのマーケティングに使える発見を整理する。

特に重視すること:
- ユーザー自身がどのような言葉で問題を表現しているか（userPhrases）。原文を短く引用し、作らない。
- 既存手段への不満、満たされていないニーズ。

根拠について:
- sourceUrls には「取得したソース」に実在するURLだけを入れる。それ以外のURLを書かない。
- 取得したソースに根拠が無い発見は、sourceUrls を空にする（一般知識からの推測として扱われる）。${COMMON_RULES}`;

function renderCandidates(candidates: ConversationCandidate[]): string {
  if (candidates.length === 0) return "(なし)";
  return candidates
    .slice(0, 20)
    .map((c) => `- ${c.url} (${c.author})\n  ${c.text.replace(/\s+/g, " ").slice(0, 400)}`)
    .join("\n");
}

export interface MarketResearcherDeps extends AgentDeps {
  web: WebResearcher | null;
  hackerNews: ConversationSource;
  productId?: string;
}

export async function runMarketResearcher(deps: MarketResearcherDeps): Promise<MarketResearchResult> {
  const { value: plan } = await deps.provider.completeStructured({
    kind: "research",
    schemaName: "market_query_plan",
    schema: QueryPlan,
    system: deps.system + PLAN_SUFFIX,
    user: `検索語の言語: ${deps.language}`,
  });

  // The two searches are independent, and either failing leaves the other.
  const [web, community] = await Promise.all([
    deps.web
      ? deps.web
          .research({
            instructions: WEB_INSTRUCTIONS,
            question: `${deps.system}\n\n# Search for\n${plan.queries.map((q) => `- ${q}`).join("\n")}\n\nAudience language: ${deps.language}`,
            maxSearches: 6,
            productId: deps.productId,
          })
          .catch(() => null)
      : Promise.resolve<WebResearchResult | null>(null),
    deps.hackerNews
      .search(cleanList(plan.englishQueries, 5), { sinceDays: 365, limit: 20 })
      .catch(() => [] as ConversationCandidate[]),
  ]);

  const known: SourceRef[] = [
    ...(web?.sources ?? []),
    ...community.map((c) => ({ url: c.url, title: `Hacker News: ${c.author}` })),
  ];

  const user = [
    "# Webでの調査メモ",
    web?.memo || "(Web検索は使えなかった。一般知識とコミュニティの投稿から推測する)",
    "",
    "# Hacker News の関連投稿",
    renderCandidates(community),
    "",
    "# 取得したソース",
    renderSources(known),
  ].join("\n");

  const { value } = await deps.provider.completeStructured({
    kind: "research",
    schemaName: "market_research",
    schema: MarketResearchOutput,
    system: deps.system + STRUCTURE_SUFFIX,
    user,
  });

  const findings = value.insights
    .filter((insight) => insight.statement.trim())
    .slice(0, 16)
    .map((insight) => {
      const sources = groundedSources(insight.sourceUrls, known);
      return {
        kind: insight.kind,
        statement: insight.statement.trim(),
        userPhrases: cleanList(insight.userPhrases, 4),
        sources,
        grounded: sources.length > 0,
      };
    });

  return { findings, plan, webUsed: Boolean(web), sourcesRead: known.length };
}
