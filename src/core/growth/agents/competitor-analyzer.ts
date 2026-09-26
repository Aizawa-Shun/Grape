import { z } from "zod";

import type { CompetitorSnapshot, SourceRef } from "@/db/schema";

import type { PublicPage } from "../sources/page";
import { snapshotOf } from "../watch";
import type { WebResearcher, WebResearchResult } from "../sources/web";
import { cleanList, COMMON_RULES, groundedSources, renderSources, type AgentDeps } from "./shared";

/**
 * CompetitorAnalyzer: who else solves this, how they talk about it, and where
 * nobody is talking yet.
 *
 * Three passes. Find candidates — the open web when available, otherwise the
 * similar services the site analysis already named and what the model knows.
 * Read each candidate's own homepage (fetchPublicPage, guarded like the
 * crawler). Then analyse from what was read. A competitor whose homepage was
 * actually read is `verified`; one that was not is still listed — an honest
 * "we could not open their site" beats silently dropping a real rival — but
 * its description is marked as coming from memory rather than from their copy.
 */

export const CompetitorCandidates = z.object({
  candidates: z
    .array(
      z.object({
        name: z.string().describe("サービス名"),
        url: z.string().describe("公式サイトのURL。確信が無ければ空文字。"),
        kind: z.enum(["direct", "alternative"]).describe("direct=同じ問題を同じやり方で解く / alternative=別のやり方で同じ問題を解く代替手段"),
      }),
    )
    .describe("競合・代替手段を3〜6件。実在するものだけ。"),
});

export const CompetitorAnalysisOutput = z.object({
  competitors: z.array(
    z.object({
      name: z.string(),
      pricing: z.string().describe("料金。ページに無ければ「確認できず」。"),
      positioning: z.string().describe("どう位置づけているか。1〜2文。"),
      targetAudience: z.string().describe("誰向けか。1文。"),
      features: z.array(z.string()).describe("主な機能。2〜5件。"),
      messaging: z.string().describe("主な訴求メッセージ。ページの見出しやコピーから。1〜2文。"),
      xHandle: z.string().describe("Xのアカウント（@付き）。ページや検索結果で確認できなければ空文字。"),
      contentStrategy: z.string().describe("発信・コンテンツのやり方。分かる範囲で1〜2文。分からなければそう書く。"),
      strengths: z.array(z.string()).describe("強み。1〜3件。"),
      weaknesses: z.array(z.string()).describe("弱み・不満を持たれている点。1〜3件。"),
      differentiation: z.string().describe("このプロダクトとの違い。1〜2文。"),
      sourceUrls: z.array(z.string()).describe("根拠のURL。「取得したソース」にあるものだけ。"),
    }),
  ),
  gaps: z
    .array(
      z.object({
        statement: z.string().describe("この市場でまだ十分に訴求されていない領域と、このプロダクトがそこを取れる理由。1〜2文。"),
        sourceUrls: z.array(z.string()),
      }),
    )
    .describe("まだ訴求されていない領域を2〜4件。競合の訴求を比べて見つける。"),
});
export type CompetitorAnalysisOutput = z.infer<typeof CompetitorAnalysisOutput>;

export interface CompetitorFinding {
  name: string;
  url: string | null;
  pricing: string;
  positioning: string;
  targetAudience: string;
  features: string[];
  messaging: string;
  xHandle: string | null;
  contentStrategy: string;
  strengths: string[];
  weaknesses: string[];
  differentiation: string;
  sources: SourceRef[];
  verified: boolean;
  /** The homepage as read now: the watch step's baseline. */
  snapshot: CompetitorSnapshot | null;
}

export interface CompetitorResult {
  competitors: CompetitorFinding[];
  gaps: { statement: string; sources: SourceRef[]; grounded: boolean }[];
  webUsed: boolean;
}

const WEB_INSTRUCTIONS = `You are a competitive-intelligence researcher. For the product described,
find its direct competitors and the alternatives people actually use instead (including
manual workarounds and general-purpose tools). For each: official URL, pricing, positioning,
who it targets, the main message on its homepage, its X (Twitter) account if any, and what
users praise or complain about. Report as a memo with citations. Do not invent products.`;

const CANDIDATE_SUFFIX = `

あなたは競合調査の担当者である。調査メモ（あれば）と、サイト分析が挙げた類似サービスから、
このプロダクトの競合・代替手段を選ぶ。${COMMON_RULES}
- URLは公式サイトのトップページにする。知らないURLを作らない（分からなければ空文字）。`;

const ANALYSIS_SUFFIX = `

あなたは競合調査の担当者である。各競合について、取得できた公式ページの内容と調査メモから分析する。
- 公式ページが取得できた競合は、そのページの文言を根拠にする。
- 取得できなかった競合は、調査メモと一般知識から書き、分からない項目は「確認できず」と書く。
- gaps は「この市場でまだ十分に訴求されていない領域」。競合の訴求（messaging）を並べて、
  誰も言っていないが見込みユーザーが困っていることを探す。${COMMON_RULES}`;

export interface CompetitorAnalyzerDeps extends AgentDeps {
  web: WebResearcher | null;
  fetchPage: (url: string) => Promise<PublicPage | null>;
  /** From the site analysis: services a reader of the product's own page would compare it to. */
  similarServices: string[];
  productId?: string;
}

function renderPage(name: string, page: PublicPage | null): string {
  if (!page) return `## ${name}\n(公式ページを取得できなかった)`;
  const headings = page.sections
    .slice(0, 12)
    .map((section) => `- ${section.heading}${section.body ? ` — ${section.body.slice(0, 160)}` : ""}`)
    .join("\n");
  return [
    `## ${name} (${page.url})`,
    `title: ${page.title ?? "(なし)"}`,
    page.meta.description ? `description: ${page.meta.description}` : null,
    headings ? `見出し:\n${headings}` : null,
    page.ctas.length ? `CTA: ${page.ctas.slice(0, 8).join(" / ")}` : null,
    page.prices.length ? `価格表記: ${page.prices.slice(0, 8).join(" / ")}` : null,
    `本文（抜粋）: ${page.text.slice(0, 1_500)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function normalizeCandidateUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function handleOf(raw: string): string | null {
  const handle = raw.trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").replace(/^@?/, "@");
  return /^@[A-Za-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

export async function runCompetitorAnalyzer(deps: CompetitorAnalyzerDeps): Promise<CompetitorResult> {
  const web: WebResearchResult | null = deps.web
    ? await deps.web
        .research({
          instructions: WEB_INSTRUCTIONS,
          question: `${deps.system}\n\nKnown similar services: ${deps.similarServices.join(", ") || "(none)"}`,
          maxSearches: 4,
          productId: deps.productId,
        })
        .catch(() => null)
    : null;

  const { value: found } = await deps.provider.completeStructured({
    kind: "research",
    schemaName: "competitor_candidates",
    effort: "low",
    schema: CompetitorCandidates,
    system: deps.system + CANDIDATE_SUFFIX,
    user: [
      "# 調査メモ",
      web?.memo || "(Web検索は使えなかった)",
      "",
      "# サイト分析が挙げた類似サービス",
      deps.similarServices.map((s) => `- ${s}`).join("\n") || "(なし)",
    ].join("\n"),
  });

  const candidates = found.candidates.slice(0, 6).map((candidate) => ({
    ...candidate,
    url: normalizeCandidateUrl(candidate.url),
  }));

  // Sequential on purpose: a handful of pages, each with its own timeout, and
  // no reason to open six sockets at once from a request that has minutes.
  const pages = new Map<string, PublicPage | null>();
  for (const candidate of candidates) {
    pages.set(candidate.name, candidate.url ? await deps.fetchPage(candidate.url) : null);
  }

  const known: SourceRef[] = [
    ...(web?.sources ?? []),
    ...[...pages.entries()]
      .filter(([, page]) => page)
      .map(([name, page]) => ({ url: page!.url, title: `${name} 公式サイト` })),
  ];

  const { value } = await deps.provider.completeStructured({
    kind: "research",
    schemaName: "competitor_analysis",
    schema: CompetitorAnalysisOutput,
    system: deps.system + ANALYSIS_SUFFIX,
    user: [
      "# 競合の公式ページ",
      candidates.map((c) => renderPage(c.name, pages.get(c.name) ?? null)).join("\n\n"),
      "",
      "# 調査メモ",
      web?.memo || "(なし)",
      "",
      "# 取得したソース",
      renderSources(known),
    ].join("\n"),
  });

  const competitors = value.competitors.slice(0, 6).map((competitor) => {
    const candidate = candidates.find((c) => c.name.toLowerCase() === competitor.name.toLowerCase());
    const page = candidate ? pages.get(candidate.name) ?? null : null;
    const sources = groundedSources(competitor.sourceUrls, known);
    if (page && !sources.some((s) => s.url === page.url)) sources.unshift({ url: page.url, title: `${competitor.name} 公式サイト` });
    return {
      name: competitor.name.trim(),
      url: page?.url ?? candidate?.url ?? null,
      pricing: competitor.pricing,
      positioning: competitor.positioning,
      targetAudience: competitor.targetAudience,
      features: cleanList(competitor.features, 6),
      messaging: competitor.messaging,
      xHandle: handleOf(competitor.xHandle),
      contentStrategy: competitor.contentStrategy,
      strengths: cleanList(competitor.strengths, 4),
      weaknesses: cleanList(competitor.weaknesses, 4),
      differentiation: competitor.differentiation,
      sources,
      verified: Boolean(page),
      snapshot: page ? snapshotOf(page) : null,
    };
  });

  const gaps = value.gaps.slice(0, 5).map((gap) => {
    const sources = groundedSources(gap.sourceUrls, known);
    return { statement: gap.statement.trim(), sources, grounded: sources.length > 0 };
  });

  return { competitors, gaps, webUsed: Boolean(web) };
}
