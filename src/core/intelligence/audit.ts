import { UNSTATED } from "@/core/context/extract";

/**
 * The cold-start path (spec section 6). A brand-new product has no funnel —
 * zero sessions means zero percentages, and reasoning over an empty funnel
 * produces a confidently wrong diagnosis. Below the traffic floor
 * (COLD_START_MIN_SESSIONS), there is nothing to measure yet, so the question
 * changes from "where do visitors drop off" to "would a visitor even
 * understand what this is" — answerable from the crawl alone, no events
 * required.
 *
 * Every check here is a fact about the crawled pages, decided the same way
 * every time — the LLM's job downstream (diagnose.ts) is to turn a list of
 * these into a narrative, not to decide whether a title tag exists.
 */

export type AuditCheckId =
  | "value_proposition"
  | "meta_description"
  | "viewport"
  | "call_to_action"
  | "js_rendering";

export interface AuditFinding {
  check: AuditCheckId;
  passed: boolean;
  detail: string;
}

/** Product Context fields the audit reads — a subset so tests do not need a full DB row. */
export interface AuditContextInput {
  what: string;
  who: string;
  gaps: string[];
}

/**
 * Only what the audit actually reads from a crawled page — deliberately not
 * `CrawledPage` itself. The DB row this really receives (crawl_pages) never
 * stored `links` (nothing downstream of the crawl needs them again), and its
 * `text`/`meta` are nullable columns rather than the crawler's always-present
 * `""` / `{}|`.
 */
export interface AuditPageInput {
  url: string;
  status: number;
  text: string | null;
  meta: Record<string, string> | null;
  renderedWith: "static" | "browser";
}

const CTA_PATTERNS =
  /(sign up|sign in|get started|try (it |for )?free|buy now|subscribe|start free|download)|無料|お試し|試してみる|今すぐ|始める|登録|購入|申し込み|ダウンロード/i;

export function runSiteAudit(pages: AuditPageInput[], context: AuditContextInput): AuditFinding[] {
  const reachable = pages.filter((page) => page.status === 200);

  return [
    valuePropositionFinding(context),
    metaDescriptionFinding(reachable),
    viewportFinding(reachable),
    callToActionFinding(reachable),
    jsRenderingFinding(reachable),
  ];
}

/**
 * Reuses the Product Context extraction rather than re-deriving it from HTML:
 * that extraction already applied the "do not invent, list what's missing as
 * a gap" discipline (extract.ts), so asking the same question twice in two
 * different ways would only add noise.
 */
function valuePropositionFinding(context: AuditContextInput): AuditFinding {
  const stated = context.what !== UNSTATED && context.who !== UNSTATED;
  return {
    check: "value_proposition",
    passed: stated,
    detail: stated
      ? "What / Who がサイト上に明示されている。"
      : `What / Who がサイト上で明示されていない（gaps: ${context.gaps.join("; ") || "詳細なし"}）。`,
  };
}

function metaDescriptionFinding(pages: AuditPageInput[]): AuditFinding {
  const withDescription = pages.find(
    (page) => page.meta?.description || page.meta?.["og:description"] || page.meta?.["manifest:description"],
  );
  return {
    check: "meta_description",
    passed: Boolean(withDescription),
    detail: withDescription
      ? `${withDescription.url} に meta description / OGP がある。`
      : "meta description も OGP も無い — 検索結果やSNSでの共有時に説明文が表示されない。",
  };
}

function viewportFinding(pages: AuditPageInput[]): AuditFinding {
  const withViewport = pages.find((page) => page.meta?.viewport);
  return {
    check: "viewport",
    passed: Boolean(withViewport),
    detail: withViewport
      ? "viewport meta タグがあり、モバイル表示に最適化されている可能性が高い。"
      : "viewport meta タグが無い — モバイル端末で正しく表示されない可能性がある。",
  };
}

function callToActionFinding(pages: AuditPageInput[]): AuditFinding {
  const withCta = pages.find((page) => CTA_PATTERNS.test(page.text ?? ""));
  return {
    check: "call_to_action",
    passed: Boolean(withCta),
    detail: withCta
      ? `${withCta.url} に行動を促す文言（登録・購入・試用など）が見つかった。`
      : "「登録する」「試してみる」のような行動を促す文言が見当たらない。",
  };
}

/**
 * Not "did Grape manage to read this site" (crawl.ts already solved that with
 * the headless-browser fallback) but "does anything that does *not* run
 * JavaScript" — a search crawler, a link preview bot — see the same page
 * Grape had to render to read. That is a Reach-stage risk independent of
 * whether the product itself is good.
 */
function jsRenderingFinding(pages: AuditPageInput[]): AuditFinding {
  const rendered = pages.filter((page) => page.renderedWith === "browser");
  return {
    check: "js_rendering",
    passed: rendered.length === 0,
    detail: rendered.length
      ? `${rendered.map((p) => p.url).join(", ")} はサーバーが返すHTMLが空で、JavaScript実行後にしか本文が読めない。検索エンジンやSNSのリンクプレビューには何も見えていない可能性がある。`
      : "サーバーが返すHTMLに本文が含まれており、JavaScriptを実行しないクローラーからも読める。",
  };
}
