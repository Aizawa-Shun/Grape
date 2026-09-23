import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, getAnthropicClient } from "@/server/ai/client";
import { fetchPageText } from "@/server/ai/fetch-page";

/**
 * URLからプロダクト登録フォームの下書きを作る。
 *
 * 目的は入力の手間を減らすことであって、内容を断定することではない。
 * ページから読み取れなかった項目は空文字で返し、利用者に入力してもらう
 * (それらしい内容で埋めない)。
 */

const SYSTEM_PROMPT = `あなたはWebサービスの登録フォームを下書きするアシスタントです。
与えられたWebページの内容から、そのサービスについて次の4項目を抽出してください。

- name: サービス名
- description: サービス概要(何ができるサービスか。1〜3文)
- targetCustomer: 想定顧客(どんな人向けか)
- problem: 解決する課題(利用者のどんな困りごとを解決するか)

最重要ルール:
- ページに書かれていないことを、想像で埋めてはいけません。
- 読み取れなかった項目は必ず空文字 "" にしてください。
  空欄のまま利用者に確認してもらう方が、それらしい嘘を書くより価値があります。
- description / targetCustomer / problem は、ページ上の表現をそのまま転記するのではなく、
  意味が伝わる自然な日本語に整えてください。
- ページが日本語でなくても、出力は日本語にしてください。
- name はページ上の正式な表記を優先してください。`;

const draftSchema = z.object({
  name: z.string(),
  description: z.string(),
  targetCustomer: z.string(),
  problem: z.string(),
});

export type ProductDraft = z.infer<typeof draftSchema>;

export interface DraftResult {
  draft: ProductDraft;
  /** 正規化後のURL(リダイレクト後の最終URL)。 */
  url: string;
  /** ページのタイトル。UIの補足表示に使う。 */
  pageTitle?: string;
}

export class DraftRefusedError extends Error {
  constructor(detail: string) {
    super(`AIがこのページの読み取りを拒否しました: ${detail}`);
    this.name = "DraftRefusedError";
  }
}

export async function draftProductFromUrl(rawUrl: string): Promise<DraftResult> {
  // 取得失敗時は PageFetchError がそのまま投げられる。
  // 呼び出し側で「読み取れなかったので手動入力してください」と案内する。
  const page = await fetchPageText(rawUrl);

  const client = await getAnthropicClient();
  const response = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 4000,
    thinking: { type: "adaptive" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `以下のWebページから4項目を抽出してください。

URL: ${page.url}

## ページ内容${page.truncated ? "(長いため冒頭のみ)" : ""}
${
  page.metadataOnly
    ? "\n注意: このページはJavaScriptで表示されるため本文を取得できず、以下はタイトル・説明文などのメタ情報のみです。" +
      "メタ情報から読み取れない項目は空文字にしてください。\n"
    : ""
}
${page.text}`,
      },
    ],
    output_config: { format: betaZodOutputFormat(draftSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new DraftRefusedError(
      response.stop_details?.explanation ?? "理由は示されませんでした"
    );
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("AIの応答を解析できませんでした。もう一度お試しください。");
  }

  return {
    draft: {
      name: parsed.name.trim(),
      description: parsed.description.trim(),
      targetCustomer: parsed.targetCustomer.trim(),
      problem: parsed.problem.trim(),
    },
    url: page.url,
    pageTitle: page.title,
  };
}
