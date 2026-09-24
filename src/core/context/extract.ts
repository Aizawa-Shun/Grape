import { z } from "zod";

import { AppError } from "@/core/errors";
import type { LLMProvider } from "@/core/llm";

import type { CrawledPage, PageSection } from "./crawl";
import { UNSTATED } from "./unstated";

/**
 * The back half of the Product Context Engine: crawled pages in, a structured
 * understanding of the product out.
 *
 * This is the single most load-bearing output in Grape. Every diagnosis, task
 * and generated artifact is reasoned against it, so a wrong Context does not
 * produce one wrong answer — it produces a season of confidently wrong ones.
 * Two consequences shape the design:
 *
 *   1. The prompt forbids inventing anything the site does not say, and gives
 *      the model an explicit way to report a gap.
 *   2. The result is always reviewable and correctable by a human before it is
 *      used (see the `editedByHuman` flag on product_contexts).
 *
 * AI is opt-in (see env.ts's LLM_PROVIDER), so this cannot assume a model is
 * ever available. The rule-based reading below — meta tags and headings,
 * assembled without inventing anything — is the actual product on a Grape
 * with no AI configured, not a degraded stand-in for one. Where a provider is
 * configured, it is handed that same reading as a draft and asked to read the
 * page and correct it, rather than starting from nothing: the rule-based pass
 * already did the part that does not need judgment.
 */

export const ProductContextExtractionSchema = z.object({
  what: z
    .string()
    .describe("この製品が何をするものか。1〜2文。サイトが使っている言葉を尊重する。"),
  who: z
    .string()
    .describe("誰のためのものか。できるだけ具体的に。曖昧なままなら曖昧だと書く。"),
  why: z
    .string()
    .describe("利用者が抱える課題。なぜ既存のやり方ではなくこれを使うのか。"),
  how: z
    .string()
    .describe("どう動くのか。仕組み・使い始め方・料金や利用条件が書かれていればそれも。"),
  /**
   * Not for display — generation needs it. A post written for a Japanese
   * product's audience should not come out in English.
   */
  primaryLanguage: z
    .string()
    .describe("サイト本文の主要言語のBCP-47コード。例: ja, en"),
  /** Which crawled URLs the answer actually rests on. */
  evidenceUrls: z.array(z.string()),
  /**
   * What the site never says. This is diagnostic on its own: a landing page
   * that does not state who it is for is a finding, not a crawl failure.
   */
  gaps: z
    .array(z.string())
    .describe("サイト上に記載が無く、推測を避けた項目。無ければ空配列。"),
  /**
   * Self-reported and advisory. Small local models routinely answer on a
   * 0-100 scale no matter what the schema says, and rejecting the response
   * over that would throw away a crawl and a completed extraction because one
   * heuristic number came back as `95` instead of `0.95`. Normalise the
   * obvious case; anything still outside the range is a genuinely broken
   * answer and fails.
   */
  confidence: z
    .preprocess(
      (value) => (typeof value === "number" && value > 1 && value <= 100 ? value / 100 : value),
      z.number().min(0).max(1),
    )
    .describe("抽出全体の確信度。0〜1の小数で答える。"),
});

export type ProductContextExtraction = z.infer<typeof ProductContextExtractionSchema>;

/**
 * Stable across every extraction, so providers with prefix caching can reuse
 * it. Nothing product-specific or time-varying may go in here.
 */
const EXTRACTION_SYSTEM = `あなたはプロダクトアナリストです。個人開発者が作ったWebサービスについて、
公開ページの内容だけを根拠に「What / Who / Why / How」を構造化して抽出します。

入力には、サイト本文に加えて「機械的な下書き」が含まれます。下書きはmeta description
などをそのまま並べただけの粗いもので、正しいとは限りません。本文を実際に読んで、
下書きより正確に書けるならその通りに書き直してください。下書きの内容がすでに
正確なら、そのまま採用して構いません。

厳守すること:

1. サイトに書かれていないことを補わない。一般的なSaaSの常識で埋めない。
   記載が無い項目は、推測せずに gaps に列挙し、該当フィールドには
   「サイト上に明示なし」と書く。
2. マーケティング的な誇張をそのまま採用しない。「世界最高の」のような
   主張は、何をするかの説明としては扱わない。
3. who は「開発者」「ビジネスパーソン」のような広い括りで済ませない。
   サイトがそこまでしか言っていない場合は、そのこと自体を gaps に入れる。
   誰向けか言えていないことは、それ自体が重要な発見である。
4. 出力の文章は日本語で書く。ただし primaryLanguage にはサイト本文の
   言語コードを入れる（日本語サイトなら ja、英語サイトなら en）。
5. evidenceUrls には、実際に根拠とした入力ページのURLだけを入れる。`;

/**
 * Meta worth quoting as evidence: the page's own description, the social
 * cards, and the machine-readable claims the crawler resolved from the PWA
 * manifest and JSON-LD (`manifest:` / `ld:`). Everything else on a `<meta>`
 * tag is rendering plumbing — viewport, theme-color, app-capable flags — and
 * says nothing about the product.
 */
const EVIDENCE_META_KEYS = /^(description|og:|twitter:|manifest:|ld:|html:lang)/;

/**
 * True once nothing was even reachable — every request failed outright (DNS,
 * timeout, non-2xx). That is different from "reached the site but the body
 * was empty", which is its own diagnosable state (see NO_TEXT_EXTRACTION
 * below) rather than a crawl failure.
 */
function nothingReachable(pages: CrawledPage[]): boolean {
  return pages.every((page) => page.status !== 200);
}

/**
 * A page is usable evidence if it carries visible copy *or* a machine-readable
 * claim about the product. The second case is what a client-rendered app looks
 * like when the browser fallback could not run: no body text, but a PWA
 * manifest that still states the product's name and one-line description.
 */
export function hasEvidence(page: CrawledPage): boolean {
  if (page.status !== 200) return false;
  if (page.text.length > 0) return true;
  return Object.keys(page.meta).some((key) => EVIDENCE_META_KEYS.test(key));
}

/** Renders crawled pages into the volatile half of the prompt. */
export function buildExtractionInput(pages: CrawledPage[], draft: ProductContextExtraction): string {
  const reachable = pages.filter(hasEvidence);

  if (pages.length === 0 || nothingReachable(pages)) {
    const detail = pages.map((page) => `- ${page.url} (status ${page.status})`).join("\n");
    // Reached the site but found nothing readable is a different problem from
    // not reaching it at all, and the advice for each differs.
    const anyResponded = pages.some((page) => page.status === 200);
    throw new AppError(
      anyResponded ? "CRAWL_EMPTY" : "CRAWL_UNREACHABLE",
      `No pages could be reached:\n${detail}`,
    );
  }

  const sections = reachable.map((page) => {
    const meta = Object.entries(page.meta)
      .filter(([key]) => EVIDENCE_META_KEYS.test(key))
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");

    return [
      `## ${page.url}`,
      `title: ${page.title ?? "(なし)"}`,
      meta ? `meta:\n${meta}` : "meta: (なし)",
      "",
      page.text,
    ].join("\n");
  });

  const unreachable = pages.filter((page) => !hasEvidence(page));
  const notes = unreachable.length
    ? `\n\n## 取得できなかったページ\n${unreachable
        .map((page) => `- ${page.url} (status ${page.status})`)
        .join("\n")}`
    : "";

  const draftSection = `## 機械的な下書き（meta description等をそのまま並べたもの。不正確な場合があります）\n${JSON.stringify(draft, null, 2)}`;

  return `以下は対象サービスの公開ページです。\n\n${sections.join("\n\n---\n\n")}${notes}\n\n---\n\n${draftSection}`;
}

/**
 * Re-exported from ./unstated so the many existing importers keep working.
 * The definition lives apart because a client component needs it too — see
 * that file.
 */
export { UNSTATED } from "./unstated";

const NO_TEXT_NOTE =
  "取得したページに本文テキストが無かったため抽出できませんでした(クライアント側JavaScriptで描画されるサイトの可能性があります)。";

/**
 * The note that has to accompany every rule-based field, because the rule is
 * a keyword match on a heading, not an understanding of the page: a section
 * titled "なぜCheeeessなのか" is quoted under `why` on the strength of the
 * word "なぜ" alone. The quoted copy is always the site's own — nothing here
 * writes a sentence the site did not — but which box it landed in is a guess,
 * and the reader is the one who can tell.
 */
const MECHANICAL_NOTE =
  "この内容はサイトの見出しと本文から機械的に拾ったものです。的外れな箇所は直してください。";

/** First reachable page stands in for "the site's own account of itself" — normally the entry URL, since crawlSite visits it first. */
function primaryPage(pages: CrawledPage[]): CrawledPage {
  return pages[0];
}

/**
 * What the site calls itself: og:site_name, the JSON-LD name, the manifest's
 * name, and only then the <title> — cut at the first " | " / " - " / " — ",
 * since titles are usually "Product — tagline" and the tagline is not a name.
 * Null when the first readable page offers none of them.
 */
export function siteNameFrom(pages: CrawledPage[]): string | null {
  const page = pages.find(hasEvidence);
  if (!page) return null;

  const stated = metaValue(page, "og:site_name", "ld:name", "manifest:name", "manifest:short_name");
  const fromTitle = page.title?.split(/\s+[|\-–—:]\s+/)[0]?.trim();
  const name = stated ?? fromTitle;
  return name ? name.slice(0, 60) : null;
}

function metaValue(page: CrawledPage, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = page.meta[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

interface LocatedSection extends PageSection {
  /** Which crawled page this heading came from, so a quote can cite it. */
  url: string;
}

/**
 * Headings that announce who the product is for. Deliberately broad on the
 * Japanese side ("〜向け", "こんな方") and anchored to the noun on the English
 * side ("for developers"), because a bare "for" matches nearly every heading
 * ever written.
 */
const AUDIENCE_HEADING =
  /向け|のため(の|に)|な人|こんな方|対象|誰のため|who ?(is|are|it'?s)?[^。.]{0,12}for\b|built for|made for|designed for|for (developers?|designers?|teams?|founders?|students?|beginners?|creators?|writers?|engineers?|marketers?|everyone)\b/i;

/** Headings that frame a problem — the "why this rather than what you already do". */
const PROBLEM_HEADING =
  /課題|悩み|困(る|った|って)|できない|大変|面倒|不便|なぜ|理由|problem|pain|why\b|struggl|tired of|instead of|frustrat/i;

/** Headings that explain mechanics, onboarding or terms of use. */
const HOWTO_HEADING =
  /使い方|使いかた|始め方|はじめ(方|かた)|仕組み|ステップ|手順|流れ|料金|価格|プラン|無料|how (it works|to)\b|getting started|get started|pricing|plans?\b|setup|set ?up|workflow|steps?\b/i;

/** Long enough to be an argument rather than a nav label, short enough to sit in a table cell. */
const MAX_FIELD_CHARS = 400;

/**
 * Below this a "body" is a stray label rather than an explanation — zenn.dev
 * has a heading "Tech" whose entire body is "？", which is true, quotable, and
 * says nothing.
 */
const MIN_BODY_CHARS = 40;

function truncate(value: string): string {
  return value.length <= MAX_FIELD_CHARS ? value : `${value.slice(0, MAX_FIELD_CHARS - 1)}…`;
}

function quoteSection(section: LocatedSection): string {
  return section.body ? `${section.heading}：${section.body}` : section.heading;
}

/**
 * Quotes up to `limit` sections whose *heading* matches, joined into one
 * field. Matching on the heading rather than the body on purpose: a body
 * mentioning "料金" in passing says nothing about the section, whereas a
 * heading is the page's own label for what follows it.
 */
function quoteMatching(
  sections: LocatedSection[],
  pattern: RegExp,
  limit = 2,
): { text: string; urls: string[] } | null {
  const matched = sections.filter((section) => pattern.test(section.heading)).slice(0, limit);
  if (matched.length === 0) return null;

  return {
    text: truncate(matched.map(quoteSection).join(" / ")),
    urls: [...new Set(matched.map((section) => section.url))],
  };
}

/**
 * Pages that exist to explain the product, as opposed to pages that merely
 * live on the same domain. The crawler already prefers these when spending
 * its page budget (see PRIORITY_PATTERNS in crawl.ts); this is the same
 * judgment applied again at quoting time, where it matters more.
 */
const EXPLAINER_PATH =
  /^\/?(about|what|product|features?|why|pricing|plans?|docs?|documentation|guide|getting-?started|faq|help|support|tour|use-?cases?)/i;

/**
 * The entry page first, then the pages written to explain the product, and
 * nothing else.
 *
 * Without this, a keyword match anywhere in the crawl wins: zenn.dev's answer
 * to "who is this for" came back as a skills blurb from one hackathon's
 * announcement page, on the strength of the word "向け" in its heading, while
 * /about — the page written to answer exactly that question — went unquoted.
 * A site states what it is on its front page and its about page; a campaign
 * page that happens to share the domain is not evidence about the product.
 */
function quotablePages(sections: LocatedSection[], entryUrl: string): LocatedSection[] {
  const own = sections.filter((section) => section.url === entryUrl);
  const explainers = sections.filter(
    (section) => section.url !== entryUrl && EXPLAINER_PATH.test(new URL(section.url).pathname),
  );
  return [...own, ...explainers];
}

/**
 * The page's own one-sentence pitch: its h1 and the line under it, or — on a
 * page with no heading markup, where every section came from
 * sectionsFromLines — whatever it leads with, since the first thing above the
 * fold is the pitch by construction.
 *
 * Frequently better copy than the meta description, and worth keeping even
 * when it disagrees with it: cheeeess.com serves a description calling itself
 * a 将棋 site while the page itself is about 8×16 chess, and showing both is
 * how its owner finds that out.
 */
function leadFrom(sections: LocatedSection[], entryUrl: string): LocatedSection | null {
  // Must have copy under it. The first thing on a front page is as often a
  // campaign banner as a pitch — zenn.dev opens with "第5回 Agentic AI
  // Hackathon エントリー受付中！" — and a banner is a headline with nothing
  // beneath it, while a pitch explains itself on the next line.
  const own = sections.filter(
    (section) => section.url === entryUrl && section.body.length >= MIN_BODY_CHARS,
  );
  return own.find((section) => section.level === 1) ?? own[0] ?? null;
}

/**
 * What the site spends its page explaining, for when no heading matched
 * HOWTO_HEADING. A landing page's h2s are its feature argument — "Dominion
 * Mode: every move paints the squares you pass through" is a real answer to
 * "how does this work", and withholding it because the heading did not
 * contain the word 仕組み would be strictly less useful than quoting it and
 * saying where it came from (see MECHANICAL_NOTE).
 */
function explanatorySections(
  sections: LocatedSection[],
  limit = 3,
): { text: string; urls: string[] } | null {
  const substantial = sections.filter((section) => section.body.length >= MIN_BODY_CHARS);
  if (substantial.length === 0) return null;

  const picked = substantial.slice(0, limit);
  return {
    text: truncate(picked.map(quoteSection).join(" / ")),
    urls: [...new Set(picked.map((section) => section.url))],
  };
}

/**
 * The no-AI baseline, and the draft an AI extraction is asked to correct.
 *
 * Reads two things the site states about itself: its metadata (description,
 * og:, JSON-LD, the PWA manifest) and its heading structure. Nothing here
 * writes a sentence the site did not — every field is either a quote or
 * `UNSTATED` — which is the same rule the extraction prompt puts on the
 * model, enforced here by construction rather than by instruction.
 *
 * What it cannot do is judge. A heading match decides which field a quote
 * lands in, so `who` is filled when a heading says "開発者向け", and left
 * unstated when the page conveys the same thing in a paragraph. That is the
 * honest boundary of a rule, and why `confidence` here tops out well below
 * what a model extraction claims.
 */
export function buildRuleBasedContext(pages: CrawledPage[]): ProductContextExtraction {
  const reachable = pages.filter(hasEvidence);
  if (reachable.length === 0) {
    return {
      what: UNSTATED,
      who: UNSTATED,
      why: UNSTATED,
      how: UNSTATED,
      primaryLanguage: "und",
      evidenceUrls: [],
      gaps: [NO_TEXT_NOTE],
      confidence: 0,
    };
  }

  const page = primaryPage(reachable);
  const sections: LocatedSection[] = quotablePages(
    reachable.flatMap((source) => source.sections.map((section) => ({ ...section, url: source.url }))),
    page.url,
  );

  const name = metaValue(page, "og:site_name") ?? metaValue(page, "ld:name") ?? page.title?.trim();
  const description = metaValue(
    page,
    "description",
    "og:description",
    "twitter:description",
    "ld:description",
    "manifest:description",
  );
  const lead = leadFrom(sections, page.url);

  // Both when both exist and they are not saying the same thing: a meta
  // description is written for search results and the pitch above the fold
  // for the reader, and the two are often complementary rather than duplicates.
  const whatParts = [
    description && name && !description.includes(name) ? `${name}。${description}` : description,
    lead && (!description || !description.includes(lead.heading)) ? quoteSection(lead) : undefined,
  ].filter((part): part is string => Boolean(part));

  // Keyword matches see every section, the lead included: a page whose only
  // heading is "開発者向け" is stating its audience, and withholding that
  // because the same heading opens the page would lose the one thing it said.
  const audience = quoteMatching(sections, AUDIENCE_HEADING);
  const problem = quoteMatching(sections, PROBLEM_HEADING);

  // The fallback does not, because it has no such evidence — it quotes
  // whatever comes first, and the lead is already quoted under `what`.
  const rest = lead ? sections.filter((section) => section !== lead) : sections;
  const howto = quoteMatching(sections, HOWTO_HEADING) ?? explanatorySections(rest);

  const gaps: string[] = [];
  if (whatParts.length === 0) gaps.push("何をするものかを説明する文が、サイトから見つかりませんでした。");
  if (!audience) gaps.push("誰のためのものかを書いた見出しが、サイトに見つかりませんでした。");
  if (!problem) gaps.push("なぜ必要とされるかを書いた見出しが、サイトに見つかりませんでした。");
  if (!howto) gaps.push("どう使うのかを書いた見出しが、サイトに見つかりませんでした。");

  const found = [whatParts.length > 0, audience, problem, howto].filter(Boolean).length;
  if (found > 0) gaps.push(MECHANICAL_NOTE);

  const evidenceUrls = [
    ...new Set([
      ...(whatParts.length > 0 ? [page.url] : []),
      ...(lead ? [lead.url] : []),
      ...(audience?.urls ?? []),
      ...(problem?.urls ?? []),
      ...(howto?.urls ?? []),
    ]),
  ];

  return {
    what: whatParts.length > 0 ? truncate(whatParts.join(" ")) : UNSTATED,
    who: audience?.text ?? UNSTATED,
    why: problem?.text ?? UNSTATED,
    how: howto?.text ?? UNSTATED,
    primaryLanguage: metaValue(page, "html:lang", "manifest:lang") ?? "und",
    evidenceUrls,
    gaps,
    // Capped at half on purpose, however many fields came back filled: every
    // one of them is a keyword match on a heading, and a rule that happened to
    // match four headings is not therefore twice as sure as a model that read
    // the page.
    confidence: found === 0 ? 0 : Math.round(Math.min(0.5, 0.15 + found * 0.1) * 100) / 100,
  };
}

export async function extractProductContext(
  pages: CrawledPage[],
  provider: LLMProvider | null,
): Promise<ProductContextExtraction> {
  // A page can be reachable (HTTP 200) and still carry nothing to reason over:
  // a client-rendered app whose initial HTML is an empty `<div id="root">`,
  // with no manifest or JSON-LD either, and with the browser fallback
  // unavailable. Neither the rule-based reading nor a model has anything to
  // work with then — report the finding directly; it is itself diagnosable
  // (spec §6), and the human can fill in Context by hand.
  if (!pages.some(hasEvidence)) {
    return buildRuleBasedContext(pages);
  }

  const draft = buildRuleBasedContext(pages);
  if (!provider) return draft;

  const { value } = await provider.completeStructured({
    kind: "extract",
    schemaName: "product_context",
    schema: ProductContextExtractionSchema,
    system: EXTRACTION_SYSTEM,
    user: buildExtractionInput(pages, draft),
  });
  return value;
}
