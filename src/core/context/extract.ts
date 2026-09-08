import { z } from "zod";

import { AppError } from "@/core/errors";
import type { LLMProvider } from "@/core/llm";

import type { CrawledPage } from "./crawl";

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
export function buildExtractionInput(pages: CrawledPage[]): string {
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

  return `以下は対象サービスの公開ページです。\n\n${sections.join("\n\n---\n\n")}${notes}`;
}

/**
 * What an unstated field is written as, both by the model (per the system
 * prompt above) and by the no-evidence fallback below. Exported so callers
 * that need to tell "stated" from "unstated" — the site audit, in
 * particular — check against the same literal rather than a second copy of it.
 */
export const UNSTATED = "サイト上に明示なし";

const NO_TEXT_NOTE =
  "取得したページに本文テキストが無かったため抽出できませんでした(クライアント側JavaScriptで描画されるサイトの可能性があります)。";

export async function extractProductContext(
  pages: CrawledPage[],
  provider: LLMProvider,
): Promise<ProductContextExtraction> {
  // A page can be reachable (HTTP 200) and still carry nothing to reason over:
  // a client-rendered app whose initial HTML is an empty `<div id="root">`,
  // with no manifest or JSON-LD either, and with the browser fallback
  // unavailable. Calling the LLM then would hand the model nothing but a
  // domain name to extrapolate from — exactly the invention the system prompt
  // forbids. Report the finding directly instead; it is itself diagnosable
  // (spec §6), and the human can fill in Context by hand.
  if (!pages.some(hasEvidence)) {
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

  const { value } = await provider.completeStructured({
    kind: "extract",
    schemaName: "product_context",
    schema: ProductContextExtractionSchema,
    system: EXTRACTION_SYSTEM,
    user: buildExtractionInput(pages),
  });
  return value;
}
