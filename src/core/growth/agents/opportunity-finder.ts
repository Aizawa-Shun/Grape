import { createHash } from "node:crypto";

import { z } from "zod";

import type { Icp, OpportunitySource } from "@/db/schema";

import type { ConversationCandidate, ConversationSource } from "../sources/types";
import type { WebResearcher } from "../sources/web";
import { cleanList, COMMON_RULES, percent, type AgentDeps } from "./shared";

/**
 * OpportunityFinder: people, right now, who may need this product.
 *
 * Half of it is deliberately not a model. Which posts are worth a model's time
 * — has someone asked a question, named a problem, asked for an alternative —
 * is a pattern match over the text (`intentScore`), and that runs in code
 * first, so the model only scores the few dozen best candidates instead of
 * every post a search returned. The model's part is the judgment a pattern
 * cannot make: does this person's problem match what this product does, and
 * why. It must say why; a score with no reasons is not shown (spec §12).
 */

export const SearchPlan = z.object({
  phrases: z
    .array(z.string())
    .describe("X検索用の短い語句を5〜8件。指定言語で。問題・困りごと・「〜ないかな」のような探している言い方を中心に。"),
  englishQueries: z.array(z.string()).describe("Hacker News検索用の英語の短い語句を3〜5件（2〜4語）。"),
});

export const ScoredOpportunities = z.object({
  results: z.array(
    z.object({
      index: z.number().int().describe("候補の番号"),
      relevance: percent.describe("このプロダクトを必要としている可能性（0〜100）"),
      reasons: z.array(z.string()).describe("そう判断した理由を2〜4件。ICPの一致・問題の一致・解決策を探しているか・このプロダクトで解けるか。日本語で短く。"),
      intent: z.enum(["seeking_solution", "complaint", "question", "discussion"]),
      icpName: z.string().describe("一致するICPの名前。無ければ空文字。"),
      recommendedAction: z
        .enum(["reply", "content", "watch"])
        .describe("reply=返信して役に立てる / content=返信より投稿のネタにする方がよい / watch=今は動かない"),
    }),
  ),
});

export interface ScoredOpportunity extends ConversationCandidate {
  relevance: number;
  reasons: string[];
  intent: "seeking_solution" | "complaint" | "question" | "discussion";
  icpName: string | null;
  recommendedAction: "reply" | "content" | "watch";
}

export interface OpportunityResult {
  opportunities: ScoredOpportunity[];
  searched: { source: OpportunitySource; found: number; error: string | null }[];
  candidates: number;
}

/** Phrases that mark someone looking for help, in the two languages Grape's users write in. */
const INTENT_PATTERNS: RegExp[] = [
  /\blooking for\b/i,
  /\bis there (a|an|any)\b/i,
  /\bhow (do|can|would) (i|you|we)\b/i,
  /\banyone (know|use|tried|recommend)/i,
  /\bi need\b/i,
  /\balternative(s)? to\b/i,
  /\brecommend(ation)?s?\b/i,
  /\bstruggl/i,
  /\bfrustrat/i,
  /\?\s*$/m,
  /ないかな|ないですか|ありますか|ある？|探して|おすすめ|教えて|どうやって|どうすれば|困って|面倒|めんどう|しんどい|つらい|代わり|代替/,
];

/** 0–1: how much a post reads like someone asking for help, from its wording alone. */
export function intentScore(text: string): number {
  const hits = INTENT_PATTERNS.filter((pattern) => pattern.test(text)).length;
  return Math.min(1, hits / 3);
}

function keywordScore(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  const hits = keywords.filter((keyword) => keyword && lower.includes(keyword.toLowerCase())).length;
  return Math.min(1, hits / 2);
}

export function containsBlocked(text: string, blockKeywords: string[]): boolean {
  const lower = text.toLowerCase();
  return blockKeywords.some((keyword) => keyword.trim() && lower.includes(keyword.trim().toLowerCase()));
}

/**
 * The code-side filter: new, not blocked, long enough to judge, ranked by
 * wording and keyword overlap with a small bonus for recency.
 */
export function prefilter(
  candidates: ConversationCandidate[],
  options: { seen: Set<string>; blockKeywords: string[]; keywords: string[]; limit: number; now?: Date },
): ConversationCandidate[] {
  const now = (options.now ?? new Date()).getTime();
  const unique = new Map<string, ConversationCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.source}:${candidate.externalId}`;
    if (options.seen.has(key) || unique.has(key)) continue;
    if (candidate.text.trim().length < 20) continue;
    if (containsBlocked(candidate.text, options.blockKeywords)) continue;
    unique.set(key, candidate);
  }
  const rank = (c: ConversationCandidate) => {
    const ageDays = c.postedAt ? (now - c.postedAt.getTime()) / 86_400_000 : 30;
    const recency = Math.max(0, 1 - ageDays / 30);
    return intentScore(c.text) * 0.5 + keywordScore(c.text, options.keywords) * 0.35 + recency * 0.15;
  };
  return [...unique.values()].sort((a, b) => rank(b) - rank(a)).slice(0, options.limit);
}

const PLAN_SUFFIX = `

あなたはこのプロダクトの見込みユーザーをSNSやコミュニティで探す担当である。
下のICPが、実際に投稿に書きそうな言葉で検索語を作る。製品名で探すのではなく、問題や「探している」言い方で探す。${COMMON_RULES}`;

const SCORE_SUFFIX = `

あなたはこのプロダクトの見込みユーザーを見つける担当である。候補の投稿それぞれについて、
投稿者がこのプロダクトを必要としている可能性を判断する。

判断の基準:
- ICPと一致するか / 抱えている問題がプロダクトの解く問題と一致するか
- 今まさに解決策を探しているか（質問・不満・「〜ないかな」）
- このプロダクトで本当に解けるか（解けないなら低くする）
- 宣伝・求人・プロダクトの告知そのものは低くする

reasons は必ず書く。スコアの根拠にならない一般論は書かない。${COMMON_RULES}`;

const WEB_INSTRUCTIONS = `You look for real people, in public conversations, who have the problem below and
are asking about it — a question, a complaint, a request for a tool or an alternative.

Search community threads, not articles: Hacker News, Indie Hackers, dev.to discussions,
GitHub issues and discussions, X, Product Hunt discussions. Prefer the last few months.

For every person you find, quote their own words from the post (one or two sentences, verbatim)
and cite the page. One quote per person. Skip vendor blog posts, listicles, documentation and
marketing pages: they are not people asking for help. Do not summarise; quote.`;

/**
 * Where people talk to each other, rather than publish. Articles are not
 * opportunities. Reddit and Stack Overflow would belong here but block
 * Anthropic's fetcher, and naming a blocked domain fails the whole request.
 */
export const CONVERSATION_DOMAINS = [
  "news.ycombinator.com",
  "indiehackers.com",
  "dev.to",
  "github.com",
  "x.com",
  "twitter.com",
  "producthunt.com",
];

export interface OpportunityFinderDeps extends AgentDeps {
  sources: ConversationSource[];
  web: WebResearcher | null;
  icps: Pick<Icp, "name" | "problem" | "keywords" | "xPhrases">[];
  seen: Set<string>;
  blockKeywords: string[];
  productId?: string;
  /** How many of the best candidates the model scores. */
  scoreLimit?: number;
}

function webCandidateId(url: string, quote: string): string {
  return createHash("sha256").update(`${url}\n${quote}`).digest("hex").slice(0, 24);
}

export async function runOpportunityFinder(deps: OpportunityFinderDeps): Promise<OpportunityResult> {
  const { value: plan } = await deps.provider.completeStructured({
    kind: "research",
    schemaName: "opportunity_search_plan",
    effort: "low",
    schema: SearchPlan,
    system: deps.system + PLAN_SUFFIX,
    user: [
      `言語: ${deps.language}`,
      "# ICP",
      deps.icps
        .map((icp) => `- ${icp.name}: ${icp.problem}\n  キーワード: ${icp.keywords.join(" / ")}\n  Xでの言い方: ${icp.xPhrases.join(" / ")}`)
        .join("\n") || "(なし)",
    ].join("\n"),
  });

  const phrases = cleanList([...plan.phrases, ...deps.icps.flatMap((icp) => icp.xPhrases)], 12);
  const english = cleanList(plan.englishQueries, 5);
  const searched: OpportunityResult["searched"] = [];
  const all: ConversationCandidate[] = [];

  for (const source of deps.sources) {
    if (!source.available()) continue;
    try {
      const found = await source.search(source.name === "hackernews" ? english : phrases, {
        // X's recent search only reaches back 7 days. Hacker News is sparse
        // for any one niche, so it gets a wider window than a feed would.
        sinceDays: source.name === "x" ? 7 : 90,
        limit: 30,
        language: source.name === "x" ? deps.language : undefined,
      });
      all.push(...found);
      searched.push({ source: source.name, found: found.length, error: null });
    } catch (error) {
      searched.push({ source: source.name, found: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (deps.web) {
    try {
      const result = await deps.web.research({
        instructions: WEB_INSTRUCTIONS,
        question: `${deps.system}\n\nThe people we look for: ${deps.icps.map((icp) => `${icp.name} — ${icp.problem}`).join("; ")}\nHow they put it: ${phrases.join(" / ")}`,
        maxSearches: 4,
        allowedDomains: CONVERSATION_DOMAINS,
        effort: "low",
        productId: deps.productId,
      });
      const found = result.citations
        .filter((citation) => citation.quote.trim().length >= 20)
        .map<ConversationCandidate>((citation) => ({
          source: "web",
          externalId: webCandidateId(citation.url, citation.quote),
          url: citation.url,
          author: new URL(citation.url).hostname,
          text: citation.quote.trim(),
          postedAt: null,
        }));
      all.push(...found);
      searched.push({ source: "web", found: found.length, error: null });
    } catch (error) {
      searched.push({ source: "web", found: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const keywords = deps.icps.flatMap((icp) => icp.keywords);
  const shortlist = prefilter(all, {
    seen: deps.seen,
    blockKeywords: deps.blockKeywords,
    keywords,
    limit: deps.scoreLimit ?? 25,
  });

  const opportunities = await scoreCandidates(shortlist, deps);
  return { opportunities, searched, candidates: all.length };
}

/**
 * The model's half: relevance, with reasons, for candidates code has already
 * shortlisted — found by a search, or pasted in by the person themselves.
 */
export async function scoreCandidates(
  shortlist: ConversationCandidate[],
  deps: AgentDeps & { icps: Pick<Icp, "name" | "problem">[] },
): Promise<ScoredOpportunity[]> {
  if (shortlist.length === 0) return [];

  const { value } = await deps.provider.completeStructured({
    kind: "research",
    schemaName: "opportunity_scores",
    schema: ScoredOpportunities,
    system: deps.system + SCORE_SUFFIX,
    user: [
      "# ICP",
      deps.icps.map((icp) => `- ${icp.name}: ${icp.problem}`).join("\n") || "(なし)",
      "",
      "# 候補の投稿",
      shortlist
        .map((c, index) => `[${index}] (${c.source}, ${c.author}) ${c.text.replace(/\s+/g, " ").slice(0, 600)}`)
        .join("\n\n"),
    ].join("\n"),
  });

  const opportunities: ScoredOpportunity[] = [];
  for (const result of value.results) {
    const candidate = shortlist[result.index];
    const reasons = cleanList(result.reasons, 4);
    // A score without reasons is not shown (spec §12) — so it is not kept either.
    if (!candidate || reasons.length === 0) continue;
    opportunities.push({
      ...candidate,
      relevance: result.relevance,
      reasons,
      intent: result.intent,
      icpName: result.icpName.trim() || null,
      recommendedAction: result.recommendedAction,
    });
  }
  opportunities.sort((a, b) => b.relevance - a.relevance);
  return opportunities;
}
