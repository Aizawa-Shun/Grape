import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, getAnthropicClient } from "@/server/ai/client";
import { fetchPageText, PageFetchError } from "@/server/ai/fetch-page";
import { aiAnalysisSchema, factCategoryLabels, type AiFact } from "@/lib/validation/product-fact";
import type { Product } from "@/server/firebase/products";

/**
 * 登録されたプロダクトをAIに理解させ、Fact / Hypothesis / 不明 に分類した情報を得る。
 *
 * 設計上の要点(マスタープロンプト§9「AI品質」):
 * - 事実と仮説を必ず分ける。判断できないものは unknown として明示的に残し、空欄を埋めない
 * - 各項目に根拠(evidence)を持たせる
 * - ページを取得できなかった場合はその事実をAIに伝え、「取得できなかった」前提で出力させる
 */

const SYSTEM_PROMPT = `あなたはWebサービスの成長支援ツール「Grape」の分析エンジンです。
個人開発者が登録したWebアプリについて、そのサービスを正確に理解することがあなたの役割です。

最重要ルール: 推測を事実として報告してはいけません。
各項目に必ず recordType を付けて、次の3つに厳密に分類してください。

- "fact": 提供された情報(サイト本文、または開発者自身の登録内容)に明記されている内容。
  根拠として、どこに書かれていたかを示せるものだけ。
- "hypothesis": 明記はされていないが、提供情報から合理的に推測できる内容。
  推測であることが明確なもの。
- "unknown": 提供された情報からは判断できない内容。
  この場合 content には「何が分からないのか」を書いてください(例:「価格体系が読み取れない」)。
  分からないことを、それらしい内容で埋めてはいけません。

出力の指針:
- カテゴリごとに1〜4件。無理に件数を揃えないでください。
- 判断材料が乏しいカテゴリは、推測を並べるより "unknown" を1件返す方が価値があります。
- evidence には、その判断の根拠を1文で書いてください。
  fact ならサイト上の該当箇所や開発者の記載、hypothesis なら推測の手がかり、
  unknown なら何が不足しているかを書きます。
- content は日本語で、1文〜2文の簡潔な記述にしてください。
- 開発者が登録時に自分で書いた内容は、その開発者自身の申告なので "fact" として扱えます。`;

export interface AnalysisResult {
  facts: AiFact[];
  model: string;
  sourceUrl: string;
  /** ページ取得に成功したか。失敗時はAIが登録内容のみから判断したことを意味する。 */
  fetchedPage: boolean;
  /** ページ取得に失敗した理由(成功時は undefined)。 */
  fetchError?: string;
}

/** AIが分類を拒否した場合のエラー。 */
export class AnalysisRefusedError extends Error {
  constructor(detail: string) {
    super(`AIがこの内容の分析を拒否しました: ${detail}`);
    this.name = "AnalysisRefusedError";
  }
}

function buildUserMessage(
  product: Product,
  page: { text: string; truncated: boolean } | undefined,
  fetchError: string | undefined
): string {
  const registered = [
    `名前: ${product.name}`,
    `URL: ${product.url}`,
    `サービス概要: ${product.description}`,
    `想定顧客: ${product.targetCustomer}`,
    `解決する課題: ${product.problem}`,
  ].join("\n");

  const categories = Object.entries(factCategoryLabels)
    .map(([key, label]) => `- ${key}: ${label}`)
    .join("\n");

  const pageSection = page
    ? `## サイトから取得した内容${page.truncated ? "(長いため冒頭のみ)" : ""}\n\n${page.text}`
    : `## サイトから取得した内容\n\n取得できませんでした(理由: ${fetchError ?? "不明"})。
サイトの内容は判断材料に使えません。開発者の登録内容のみに基づいて分析し、
サイトを見なければ分からない項目は "unknown" としてください。`;

  return `以下のWebアプリを分析してください。

## 開発者が登録した内容(開発者自身の申告)

${registered}

${pageSection}

## 分類するカテゴリ

${categories}

上記のカテゴリごとに、fact / hypothesis / unknown を明示して整理してください。`;
}

export async function analyzeProduct(product: Product): Promise<AnalysisResult> {
  const client = await getAnthropicClient();

  let page: { text: string; truncated: boolean } | undefined;
  let fetchError: string | undefined;
  try {
    const fetched = await fetchPageText(product.url);
    page = { text: fetched.text, truncated: fetched.truncated };
  } catch (error) {
    // ページ取得の失敗は分析全体の失敗にしない。
    // 「取得できなかった」ことをAIにも利用者にも伝えた上で、登録内容のみで分析する。
    fetchError = error instanceof PageFetchError ? error.message : "ページを取得できませんでした";
  }

  const response = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(product, page, fetchError) }],
    output_config: { format: betaZodOutputFormat(aiAnalysisSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new AnalysisRefusedError(
      response.stop_details?.explanation ?? "理由は示されませんでした"
    );
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("AIの応答を解析できませんでした。もう一度お試しください。");
  }

  return {
    facts: parsed.facts,
    model: response.model,
    sourceUrl: product.url,
    fetchedPage: page !== undefined,
    fetchError,
  };
}
