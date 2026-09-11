import { describe, expect, it } from "vitest";

import type { CrawledPage } from "./crawl";
import {
  ProductContextExtractionSchema,
  buildExtractionInput,
  buildRuleBasedContext,
  hasEvidence,
} from "./extract";

function page(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: "https://example.com/",
    status: 200,
    title: null,
    text: "",
    meta: {},
    sections: [],
    links: [],
    renderedWith: "static",
    ...overrides,
  };
}

function section(heading: string, body = "", level = 2) {
  return { heading, body, level };
}

describe("ProductContextExtractionSchema", () => {
  const valid = {
    what: "オンラインチェス",
    who: "チェス好き",
    why: "対戦相手が見つからない",
    how: "ブラウザで対局する",
    primaryLanguage: "ja",
    evidenceUrls: ["https://example.com/"],
    gaps: [],
  };

  it("rescues a confidence reported on a 0-100 scale", () => {
    // Observed from qwen2.5:1.5b: everything else was correct and the whole
    // registration failed on this one number.
    expect(ProductContextExtractionSchema.parse({ ...valid, confidence: 95 }).confidence).toBe(0.95);
  });

  it("leaves a well-formed confidence alone", () => {
    expect(ProductContextExtractionSchema.parse({ ...valid, confidence: 0.8 }).confidence).toBe(0.8);
    expect(ProductContextExtractionSchema.parse({ ...valid, confidence: 1 }).confidence).toBe(1);
  });

  it("still rejects a number that is not a confidence at all", () => {
    expect(ProductContextExtractionSchema.safeParse({ ...valid, confidence: 500 }).success).toBe(false);
    expect(ProductContextExtractionSchema.safeParse({ ...valid, confidence: -1 }).success).toBe(false);
  });
});

describe("hasEvidence", () => {
  it("accepts a page with visible text", () => {
    expect(hasEvidence(page({ text: "何かの説明" }))).toBe(true);
  });

  it("accepts a page whose only content is machine-readable", () => {
    // The client-rendered case with no browser available: empty body, but the
    // manifest still states what the product is.
    expect(hasEvidence(page({ meta: { "manifest:description": "オンラインチェスアプリ" } }))).toBe(true);
  });

  it("rejects a page carrying only rendering plumbing", () => {
    expect(hasEvidence(page({ meta: { viewport: "width=device-width", "theme-color": "#000" } }))).toBe(
      false,
    );
  });

  it("rejects a page that was never reached", () => {
    expect(hasEvidence(page({ status: 404, text: "Not found" }))).toBe(false);
  });
});

describe("buildExtractionInput", () => {
  it("quotes machine-readable claims as evidence and hides the plumbing", () => {
    const pages = [
      page({
        text: "本文",
        meta: {
          "manifest:description": "オンラインチェスアプリ",
          "ld:name": "Cheeeess",
          "og:title": "Cheeeess",
          "html:lang": "ja",
          viewport: "width=device-width",
          "theme-color": "#000000",
        },
      }),
    ];
    const input = buildExtractionInput(pages, buildRuleBasedContext(pages));

    expect(input).toContain("manifest:description: オンラインチェスアプリ");
    expect(input).toContain("ld:name: Cheeeess");
    expect(input).toContain("html:lang: ja");
    expect(input).not.toContain("viewport");
    expect(input).not.toContain("theme-color");
  });

  it("includes a page that has no text but does have a manifest", () => {
    const pages = [page({ meta: { "manifest:name": "Cheeeess" } })];
    const input = buildExtractionInput(pages, buildRuleBasedContext(pages));

    expect(input).toContain("manifest:name: Cheeeess");
    expect(input).not.toContain("取得できなかったページ");
  });

  it("throws only when nothing was reachable at all", () => {
    const pages = [page({ status: 0 }), page({ status: 404 })];
    expect(() => buildExtractionInput(pages, buildRuleBasedContext(pages))).toThrow(
      /no pages could be reached/i,
    );
  });
});

describe("buildRuleBasedContext", () => {
  const explanation = "これは本文として扱われるだけの長さを持った説明文です。ここに中身が書かれています。";

  it("reads what from the page's own description, without asking who or why", () => {
    const result = buildRuleBasedContext([
      page({
        title: "Cheeeess",
        text: "本文",
        meta: { description: "友達とブラウザでチェス対局ができるサービス", "html:lang": "ja" },
      }),
    ]);

    expect(result.what).toContain("友達とブラウザでチェス対局ができるサービス");
    expect(result.who).toBe("サイト上に明示なし");
    expect(result.why).toBe("サイト上に明示なし");
    expect(result.primaryLanguage).toBe("ja");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(1);
  });

  it("quotes the site about who it is for when a heading says so", () => {
    const result = buildRuleBasedContext([
      page({
        text: "本文",
        meta: { description: "説明" },
        sections: [section("個人開発者向け", explanation)],
      }),
    ]);

    expect(result.who).toContain("個人開発者向け");
    expect(result.who).toContain(explanation);
  });

  it("quotes the problem a heading frames, under why", () => {
    const result = buildRuleBasedContext([
      page({
        text: "本文",
        meta: { description: "説明" },
        sections: [section("なぜ必要なのか", explanation)],
      }),
    ]);

    expect(result.why).toContain("なぜ必要なのか");
  });

  /**
   * The alternative was leaving `how` empty on every site that explains itself
   * without ever using the word 仕組み — which is most of them.
   */
  it("falls back to whatever the page actually explains when no heading matches how", () => {
    const result = buildRuleBasedContext([
      page({
        text: "本文",
        meta: { description: "説明" },
        sections: [
          section("ヒーロー", explanation),
          section("Dominion Mode", explanation),
          section("盤面を塗る", explanation),
        ],
      }),
    ]);

    expect(result.how).toContain("Dominion Mode");
    expect(result.how).toContain("盤面を塗る");
  });

  it("never repeats the lead it already quoted under what", () => {
    const result = buildRuleBasedContext([
      page({
        text: "本文",
        sections: [section("見出しA", explanation), section("見出しB", explanation)],
      }),
    ]);

    expect(result.what).toContain("見出しA");
    expect(result.how).not.toContain("見出しA");
    expect(result.how).toContain("見出しB");
  });

  /**
   * zenn.dev answered "who is this for" out of one hackathon's announcement
   * page, on the word "向け" alone, while /about went unread.
   */
  it("ignores headings on pages that are not about the product", () => {
    const result = buildRuleBasedContext([
      page({ url: "https://example.com/", text: "本文", meta: { description: "説明" } }),
      page({
        url: "https://example.com/campaigns/2026-spring",
        text: "本文",
        sections: [section("学生向けキャンペーン", explanation)],
      }),
    ]);

    expect(result.who).toBe("サイト上に明示なし");
  });

  it("does quote a page written to explain the product", () => {
    const result = buildRuleBasedContext([
      page({ url: "https://example.com/", text: "本文", meta: { description: "説明" } }),
      page({
        url: "https://example.com/about",
        text: "本文",
        sections: [section("学生向けのサービスです", explanation)],
      }),
    ]);

    expect(result.who).toContain("学生向けのサービスです");
    expect(result.evidenceUrls).toContain("https://example.com/about");
  });

  /** Every field is a keyword match on a heading, however many of them landed. */
  it("never claims more than half confidence, since a heading match is not a reading", () => {
    const result = buildRuleBasedContext([
      page({
        text: "本文",
        meta: { description: "説明" },
        sections: [
          section("開発者向け", explanation),
          section("なぜ必要か", explanation),
          section("使い方", explanation),
        ],
      }),
    ]);

    expect(result.who).not.toBe("サイト上に明示なし");
    expect(result.why).not.toBe("サイト上に明示なし");
    expect(result.how).not.toBe("サイト上に明示なし");
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });

  it("falls back to unstated everywhere when the site has no description at all", () => {
    const result = buildRuleBasedContext([page({ title: "何もない", text: "本文だけ" })]);

    expect(result.what).toBe("サイト上に明示なし");
    expect(result.confidence).toBe(0);
    expect(result.gaps.length).toBeGreaterThan(0);
  });

  it("returns the fully-unstated shape when no page has any evidence at all", () => {
    const result = buildRuleBasedContext([page({ status: 404 })]);

    expect(result.what).toBe("サイト上に明示なし");
    expect(result.evidenceUrls).toEqual([]);
    expect(result.confidence).toBe(0);
  });
});
