import { AppError } from "@/core/errors";
import type { LLMProvider } from "@/core/llm";

import { SaasJudgmentSchema, SaasReadingSchema, type SaasAnalysis } from "./analysis";
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
/**
 * The judgment half re-reads the pages with less body text: it already has
 * the reading, and needs the pages for the scorecard's reasons and for
 * quotes — which headings, CTAs and the opening of each page carry. Measured
 * on a real site, the two halves were ~37k and ~41k input tokens, and the
 * prompt cache did not carry across them (the output schema differs), so
 * this is where registration's cost is.
 */
const JUDGMENT_PAGE_CHARS = 2_500;

const ANALYSIS_SYSTEM = `あなたはSaaSアナリストである。あるWebサービスの公開ページを読み、
そのサービスを理解するための構造化された分析と、現状の採点を作る。

出力の各項目には status を付ける。意味は次の通り。

- confirmed: サイトに明記されている。根拠となる文がページ上に実在する。
- inferred: サイトの記述から論理的に導ける。直接は書かれていない。
- unknown: サイトからは判断できない。

重要な原則:

1. すべての項目を埋める。空文字・空配列・「未確認」「不明」だけの回答は出力として認めない。
   サイトに書かれていない項目でも、ページ上の手がかりから最も妥当な読みを書き、
   その確からしさは status（inferred / unknown）で示す。
   値を書かないことは「分からない」を伝える手段ではない。status がその役割を持つ。
2. 推測を禁止しているのではない。推測を「事実として書くこと」を禁止している。
   サイトの内容から妥当に導けることは inferred として積極的に書く。
   例: チェス盤の画像、「対局する」ボタン、ルール説明ページがあるなら、
   「チェスをプレイしたい人向け」は inferred として妥当である。
3. unknown は、手がかりが本当に無いときに使う。その場合も値は書く。
   例: 料金ページが無いサイトの料金は「無料で使える範囲しか示されておらず、
   有料プランの有無は判断できない」のように、何が分からないかまで書く。
4. 分量を守る。各項目の指定（文数・件数）は下限でもある。
   一文で済ませずに、読んだ人がそれだけで判断できる具体さまで書く。
   ただし同じ内容を言い換えて字数を稼がない。
5. サイトに存在しない機能を作らない。features はサイト上で確認できるものを優先する。
6. 競合は断定しない。similarServices は「類似・候補」として扱う。
7. evidence には、主要な項目について
   「どのページの・どの文を根拠に・なぜそう判断したか」を入れる。
   quote は必ず入力に実在する文章をそのまま使う。要約しない。
   topic には対象項目のキー（service.who, business.pricing など）を入れる。
8. 出力の文章はすべて日本語で書く。
   ただし primaryLanguage にはサイト本文の言語コードを入れる。
9. 文体は「である調」で統一する。「です・ます」「〜してください」「〜しましょう」は使わない。
   敬語も使わない。読み手に呼びかけず、観察と判断を述べる。
10. oneLiner は、そのサービスを知らない人が一読して理解できる一文にする。
   誇張表現をそのまま採用しない。

assessment（現状の採点）について:

- 6つの軸それぞれに1〜5の整数を付け、その点にした理由をページ上の事実から書く。
  1=ほぼ手つかず、2=弱い、3=ふつう、4=よくできている、5=言うことがない。
- 採点するのは「サイトがそのプロダクトをどう説明できているか」であって、
  プロダクトの善し悪しではない。訪問数・売上・継続率は入力に無いので採点しない。
- 全部を3や4で揃えない。最も弱い軸が1つ決まるように差を付ける。
- 根拠が無いまま高い点を付けない。見当たらない要素（料金表・実績・導線）は
  素直に低く付ける。低い点は欠陥の指摘ではなく、次に手を入れる場所である。
- priority は、点数が最も低い軸と食い違わせない。

market.positioning（位置づけの図）について:

- similarServices に挙げたサービスと、このサービスを2軸の図に置く。
- 軸は、これらのサービスが最もばらつく観点を2つ選ぶ。2つの軸は互いに独立した観点にする。
  「良い/悪い」の軸は作らない。どちらの端も、選ぶ人がいる性質にする。
- 座標は1〜5。同じ点に重ねない。このサービスの位置は、サイトの記述から判断する。
- takeaway には、図から読み取れる立ち位置と、競合が少ない領域を書く。

insights の weaknesses（弱み）と threats（脅威）について:

- weaknesses は、サイトから読み取れるこのサービス側の不足。採点で低かった軸と矛盾させない。
- threats は、外部の要因（競合・無料の代替手段・市場の変化）。サイトの欠点は書かない。`;

/** One page, flattened into the parts of it that carry meaning. */
function renderPage(page: CrawledPage, maxChars: number = MAX_PAGE_CHARS): string {
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
    page.text.slice(0, maxChars),
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAnalysisInput(pages: CrawledPage[], maxChars: number = MAX_PAGE_CHARS): string {
  const readable = pages.filter(hasEvidence).slice(0, MAX_PAGES_IN_PROMPT);
  const unreadable = pages.filter((page) => !hasEvidence(page));

  const notes =
    unreadable.length > 0
      ? `\n\n## 読み取れなかったページ\n${unreadable
          .map((page) => `- ${page.url} (status ${page.status})`)
          .join("\n")}`
      : "";

  return `以下は対象サービスの公開ページです。複数ページの情報を統合して、1つの分析を作ってください。

${readable.map((page) => renderPage(page, maxChars)).join("\n\n---\n\n")}${notes}`;
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

  // Two calls, because the whole schema is too large for Anthropic's
  // grammar compiler (see SaasReadingSchema). The second is handed the
  // first's answer, so the map and the scorecard are about the same service
  // the reading describes, and reads shorter page text (JUDGMENT_PAGE_CHARS).
  const system = `${ANALYSIS_SYSTEM}\n\n# 入力\n${buildAnalysisInput(pages)}`;
  const judgmentSystem = `${ANALYSIS_SYSTEM}\n\n# 入力\n${buildAnalysisInput(pages, JUDGMENT_PAGE_CHARS)}`;

  const { value: reading } = await provider.completeStructured({
    kind: "extract",
    schemaName: "saas_reading",
    schema: SaasReadingSchema,
    system,
    user:
      "前半として、overview・service・targetUsers・business・market（category / industry / similarServices）・primaryLanguage を出力する。" +
      "positioning・insights・assessment・evidence はこのあと別に聞くので、ここでは出力しない。",
  });

  const { value: judgment } = await provider.completeStructured({
    kind: "extract",
    schemaName: "saas_judgment",
    schema: SaasJudgmentSchema,
    system: judgmentSystem,
    user: [
      "後半として、positioning（market.positioning の図）・insights・assessment・evidence を出力する。",
      "前半で読み取った内容は次のとおり。これと矛盾させない。positioning.others には similarServices と同じものを置く。",
      "",
      JSON.stringify(reading),
    ].join("\n"),
  });

  return {
    ...reading,
    market: { ...reading.market, positioning: judgment.positioning },
    insights: judgment.insights,
    assessment: judgment.assessment,
    evidence: judgment.evidence,
  };
}
