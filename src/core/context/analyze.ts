import { AppError } from "@/core/errors";
import type { LLMProvider } from "@/core/llm";

import { SaasAnalysisSchema, type SaasAnalysis } from "./analysis";
import type { CrawledPage } from "./crawl";
import { hasEvidence } from "./extract";

/**
 * Reads a crawled site and produces the structured analysis the product page
 * renders.
 *
 * This replaces asking a model for four sentences. The four-sentence version
 * had one failure mode that dominated everything else: told never to guess, it
 * answered "サイト上に明示なし" to three of the four questions on almost every
 * real site, because almost no landing page spells out its audience in so many
 * words. The result was technically honest and practically useless — a page
 * that said nothing about a product whose site plainly said something.
 *
 * The fix is not to let the model invent. It is to let it reason and then say
 * so: every claim it returns carries `confirmed`, `inferred` or `unknown`, and
 * an inference has to cite the copy it reasoned from (see analysis.ts). A
 * chess site that never writes the words "for chess players" still supports
 * "チェスをプレイしたい人" as an inference from a board, a Play button and a
 * rules page — and the reader can see exactly that chain and overrule it.
 */

/** Both halves of the prompt are large; a truncated answer is a failed extraction. */
const MAX_PAGE_CHARS = 6_000;
const MAX_PAGES_IN_PROMPT = 8;

const ANALYSIS_SYSTEM = `あなたはSaaSアナリストです。あるWebサービスの公開ページを読み、
そのサービスを理解するための構造化された分析を作ります。

出力の各項目には status を付けます。意味は次の通りです。

- confirmed: サイトに明記されている。根拠となる文がページ上に実在する。
- inferred: サイトの記述から論理的に導ける。直接は書かれていない。
- unknown: サイトからは判断できない。

重要な原則:

1. 推測を禁止しているのではありません。推測を「事実として書くこと」を禁止しています。
   サイトの内容から妥当に導けることは inferred として積極的に書いてください。
   例: チェス盤の画像、「対局する」ボタン、ルール説明ページがあるなら、
   「チェスをプレイしたい人向け」は inferred として妥当です。
2. unknown は、手がかりが本当に無いときだけ使ってください。
   料金ページが無いサイトの料金は unknown です。
   一方、無料で使えるボタンしか無いサービスの課金方式を
   「フリーミアムの可能性」と書くのは inferred です。
3. サイトに存在しない機能を作らないでください。features は
   サイト上で確認できるものを優先します。
4. 競合は断定しないでください。similarServices は「類似・候補」として扱います。
5. evidence には、主要な項目について
   「どのページの・どの文を根拠に・なぜそう判断したか」を入れてください。
   quote は必ず入力に実在する文章をそのまま使います。要約しないでください。
   topic には対象項目のキー（service.who, business.pricing など）を入れます。
6. 出力の文章はすべて日本語で書いてください。
   ただし primaryLanguage にはサイト本文の言語コードを入れます。
7. oneLiner は、そのサービスを知らない人が一読して理解できる一文にしてください。
   誇張表現をそのまま採用しないでください。`;

/** One page, flattened into the parts of it that carry meaning. */
function renderPage(page: CrawledPage): string {
  const meta = Object.entries(page.meta)
    .filter(([key]) => /^(description|og:|twitter:|manifest:|ld:)/.test(key))
    .map(([key, value]) => `  ${key}: ${value}`)
    .join("\n");

  const headings = page.sections
    .map((section) => (section.body ? `  - ${section.heading} — ${section.body}` : `  - ${section.heading}`))
    .join("\n");

  return [
    `## ${page.url}`,
    `title: ${page.title ?? "(なし)"}`,
    meta ? `meta:\n${meta}` : null,
    headings ? `見出しと本文:\n${headings}` : null,
    page.ctas.length > 0 ? `ボタン・CTA: ${page.ctas.join(" / ")}` : null,
    page.prices.length > 0 ? `価格らしき表記: ${page.prices.join(" / ")}` : null,
    "本文:",
    page.text.slice(0, MAX_PAGE_CHARS),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAnalysisInput(pages: CrawledPage[]): string {
  const readable = pages.filter(hasEvidence).slice(0, MAX_PAGES_IN_PROMPT);
  const unreadable = pages.filter((page) => !hasEvidence(page));

  const notes =
    unreadable.length > 0
      ? `\n\n## 読み取れなかったページ\n${unreadable
          .map((page) => `- ${page.url} (status ${page.status})`)
          .join("\n")}`
      : "";

  return `以下は対象サービスの公開ページです。複数ページの情報を統合して、1つの分析を作ってください。

${readable.map(renderPage).join("\n\n---\n\n")}${notes}`;
}

export async function analyzeSaas(
  pages: CrawledPage[],
  provider: LLMProvider,
): Promise<SaasAnalysis> {
  // Nothing readable anywhere: a client-rendered shell the browser fallback
  // could not reach, or a site that is entirely down. There is no prompt worth
  // sending — the model would have a domain name and nothing else, which is
  // the one situation where it really would have to invent.
  if (!pages.some(hasEvidence)) {
    throw new AppError(
      pages.some((page) => page.status === 200) ? "CRAWL_EMPTY" : "CRAWL_UNREACHABLE",
      `No readable page among ${pages.length}`,
    );
  }

  const { value } = await provider.completeStructured({
    kind: "extract",
    schemaName: "saas_analysis",
    schema: SaasAnalysisSchema,
    system: ANALYSIS_SYSTEM,
    user: buildAnalysisInput(pages),
  });

  return value;
}
