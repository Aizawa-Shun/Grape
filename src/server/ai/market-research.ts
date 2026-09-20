import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { AI_MODEL, getAnthropicClient } from "@/server/ai/client";
import { aiResearchSchema, insightCategoryLabels, insightCategoryHints, type AiInsight } from "@/lib/validation/market-insight";
import type { Product } from "@/server/firebase/products";
import type { ProductFact } from "@/server/firebase/product-facts";
import { factCategoryLabels } from "@/lib/validation/product-fact";

/**
 * 市場調査(Phase 4)。
 *
 * 2段構成にしている理由:
 * 1. 調査パス: Web検索ツールを使い、実在するページを根拠に調査させる。
 *    構造化出力(output_config.format)はCitationsと併用できないため、この段では使わない。
 * 2. 構造化パス: 調査結果のテキストを、fact/hypothesis/unknown 付きのJSONへ変換する。
 *
 * 捏造対策として、構造化パスには「調査パスで実際に検索結果として得られたURLの一覧」を渡し、
 * その中のURLしか sourceUrl に使わないよう制約する。
 */

const MAX_SEARCHES = 8;
const MAX_CONTINUATIONS = 5;

const RESEARCH_SYSTEM = `あなたはWebサービスの成長支援ツール「Grape」の市場調査エンジンです。
個人開発者のサービスについて、認知拡大・利用者獲得の施策を考えるための市場情報を調べます。

必ずweb_searchツールで実際に検索し、見つけた情報に基づいて報告してください。

調査する観点:
1. ターゲット顧客 — どんな人が、どんな状況でこの種のサービスを使うか
2. 顧客の課題 — その人たちが実際に困っていること(できるだけ一次情報・生の声)
3. 競合・代替手段 — 今その課題をどう解決しているか。具体的なサービス名
4. 顧客が情報を探す場所 — その人たちが集まるコミュニティ、SNS、掲示板、検索キーワード

最重要ルール:
- 検索で確認できなかったことを、事実であるかのように書かないでください。
- 検索しても分からなかった観点は「分からなかった」と明記してください。
  それ自体が利用者にとって価値のある情報です。
- 具体的なサービス名・コミュニティ名を挙げるときは、必ず検索で存在を確認したものだけにしてください。
- 各項目について、どのページで確認したかURLを明記してください。

日本語で報告してください。日本語圏のサービスであれば日本語での検索も行ってください。`;

const STRUCTURE_SYSTEM = `あなたは調査レポートを構造化データに変換する処理エンジンです。

与えられた調査レポートを読み、カテゴリごとの項目に分解してください。

各項目には recordType を必ず付けます:
- "fact": 調査レポート内で、情報源URLとともに確認されたと書かれている内容
- "hypothesis": レポート内で推測・可能性として書かれている内容
- "unknown": レポート内で「分からなかった」「確認できなかった」と書かれている内容。
  content には何が分からなかったのかを書く

sourceUrl のルール(厳守):
- 「利用可能なURL一覧」に含まれるURLだけを使ってください。
- 一覧に無いURLを書いてはいけません。推測でURLを組み立てることも禁止です。
- 該当するURLが無い場合は空文字 "" にしてください。
- recordType が "unknown" の場合は原則として空文字にしてください。

sourceTitle は、そのURLに対応するページタイトルを一覧から転記してください。無ければ空文字。
evidence には、その判断の根拠を1文で書いてください。
content は日本語で1〜2文の簡潔な記述にしてください。
カテゴリごとに最大4件まで。無理に件数を揃えないでください。`;

export interface ResearchResult {
  insights: AiInsight[];
  model: string;
  searchCount: number;
}

export class ResearchRefusedError extends Error {
  constructor(detail: string) {
    super(`AIがこの内容の調査を拒否しました: ${detail}`);
    this.name = "ResearchRefusedError";
  }
}

interface FoundSource {
  url: string;
  title: string;
}

/** 応答内のWeb検索結果から、実在が確認できたURLを集める。 */
function collectSources(
  content: Anthropic.Beta.BetaContentBlock[],
  into: Map<string, FoundSource>
): number {
  let searches = 0;

  for (const block of content) {
    if (block.type === "server_tool_use" && block.name === "web_search") {
      searches += 1;
      continue;
    }
    if (block.type !== "web_search_tool_result") {
      continue;
    }
    // 検索がエラーになった場合 content はリストではなくエラーオブジェクトになる。
    const results = block.content;
    if (!Array.isArray(results)) {
      continue;
    }
    for (const r of results) {
      if (r.type === "web_search_result" && r.url && !into.has(r.url)) {
        into.set(r.url, { url: r.url, title: r.title ?? "" });
      }
    }
  }

  return searches;
}

function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

function buildResearchPrompt(product: Product, facts: ProductFact[]): string {
  const confirmed = facts.filter((f) => f.recordType !== "unknown");
  const factLines = confirmed.length
    ? confirmed
        .map((f) => `- [${factCategoryLabels[f.category]}] ${f.content}`)
        .join("\n")
    : "(まだ整理されていません)";

  const angles = Object.entries(insightCategoryLabels)
    .map(([key, label]) => `- ${label}: ${insightCategoryHints[key as keyof typeof insightCategoryHints]}`)
    .join("\n");

  return `以下のWebサービスの市場を調査してください。

## 対象サービス

名前: ${product.name}
URL: ${product.url}
サービス概要: ${product.description}
想定顧客(開発者の申告): ${product.targetCustomer}
解決する課題(開発者の申告): ${product.problem}

## Grapeがこれまでに整理したこのサービスの情報

${factLines}

## 調査してほしい観点

${angles}

開発者の申告を鵜呑みにせず、実際に市場でどうなっているかを検索して確認してください。`;
}

function buildStructurePrompt(report: string, sources: FoundSource[]): string {
  const sourceList = sources.length
    ? sources.map((s) => `- ${s.url}${s.title ? ` (${s.title})` : ""}`).join("\n")
    : "(検索結果なし。すべての sourceUrl を空文字にしてください)";

  const categories = Object.entries(insightCategoryLabels)
    .map(([key, label]) => `- ${key}: ${label}`)
    .join("\n");

  return `## 調査レポート

${report}

## 利用可能なURL一覧(この中のURLだけを sourceUrl に使うこと)

${sourceList}

## カテゴリ

${categories}

上記レポートを、カテゴリごとの項目に構造化してください。`;
}

/** 調査パス: Web検索を使って市場を調べ、レポートテキストと参照URLを得る。 */
async function runResearchPass(
  client: Anthropic,
  product: Product,
  facts: ProductFact[]
): Promise<{ report: string; sources: FoundSource[]; searchCount: number; model: string }> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: buildResearchPrompt(product, facts) },
  ];

  const sources = new Map<string, FoundSource>();
  let searchCount = 0;
  let model = AI_MODEL;
  let report = "";

  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const response = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: RESEARCH_SYSTEM,
      messages,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES },
      ],
    });

    model = response.model;

    if (response.stop_reason === "refusal") {
      throw new ResearchRefusedError(
        response.stop_details?.explanation ?? "理由は示されませんでした"
      );
    }

    searchCount += collectSources(response.content, sources);
    report = textOf(response.content);

    // サーバー側のツール実行ループが上限に達した場合は、同じ会話を再送すると再開できる。
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    break;
  }

  return { report, sources: [...sources.values()], searchCount, model };
}

/** 構造化パス: レポートをFact/Hypothesis/不明に分類したJSONへ変換する。 */
async function runStructurePass(
  client: Anthropic,
  report: string,
  sources: FoundSource[]
): Promise<AiInsight[]> {
  const response = await client.beta.messages.parse({
    model: AI_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: STRUCTURE_SYSTEM,
    messages: [{ role: "user", content: buildStructurePrompt(report, sources) }],
    output_config: { format: betaZodOutputFormat(aiResearchSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new ResearchRefusedError(
      response.stop_details?.explanation ?? "理由は示されませんでした"
    );
  }

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("AIの応答を解析できませんでした。もう一度お試しください。");
  }

  // 指示に反して一覧外のURLが混ざった場合は、捏造を保存しないよう落とす。
  const allowed = new Set(sources.map((s) => s.url));
  return parsed.insights.map((insight) =>
    insight.sourceUrl && allowed.has(insight.sourceUrl)
      ? insight
      : { ...insight, sourceUrl: "", sourceTitle: "" }
  );
}

export async function researchMarket(
  product: Product,
  facts: ProductFact[]
): Promise<ResearchResult> {
  const client = getAnthropicClient();

  const { report, sources, searchCount, model } = await runResearchPass(client, product, facts);
  if (!report.trim()) {
    throw new Error("AIから調査結果が返りませんでした。もう一度お試しください。");
  }

  const insights = await runStructurePass(client, report, sources);

  return { insights, model, searchCount };
}
