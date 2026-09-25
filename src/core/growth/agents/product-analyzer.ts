import { z } from "zod";

import type { SaasAnalysis } from "@/core/context/analysis";
import { renderContextSnapshot } from "@/core/context/snapshot";
import type { LLMProvider } from "@/core/llm/types";
import type { Product, ProductContext } from "@/db/schema";

import { cleanList, COMMON_RULES } from "./shared";

/**
 * ProductAnalyzer: turns what Grape already read off the site — the Product
 * Context and, when a model produced one, the full SaaS analysis — into the
 * Product Knowledge Base the growth agents work from.
 *
 * It does not crawl. Registration already did, and the reader has already
 * confirmed or corrected the result on the review screen; reading the site a
 * second time would ignore that correction. What it adds is the marketing
 * reading of the same material: the USP, the use cases, and the angles a post
 * could take.
 */

export const ProductAnalyzerOutput = z.object({
  summary: z.string().describe("このプロダクトが何かを3〜5文で。何をするもので、誰の何を、どう解決するか。である調。"),
  problem: z.string().describe("ユーザーが抱えている問題。1〜3文。"),
  solution: z.string().describe("プロダクトがそれをどう解決するか。1〜3文。"),
  targetUser: z.string().describe("誰が使うか。役割と状況まで具体的に。1〜2文。"),
  usp: z.array(z.string()).describe("競合や代替手段と比べたときの特徴。2〜5件。サイトから言えることだけ。"),
  useCases: z.array(z.string()).describe("代表的な利用ケース。3〜5件。「〜が〜するときに〜する」の形で具体的に。"),
  features: z.array(z.string()).describe("主な機能。3〜8件。サイトで確認できるものだけ。"),
  pricing: z.string().describe("料金。サイトに無ければ「サイトに記載なし」と書く。"),
  marketingAngles: z
    .array(
      z.object({
        name: z.string().describe("切り口の名前。例: Time saving / Automation / Alternative to X。英語の短い名前でよい。"),
        description: z.string().describe("その切り口で何を訴求するか。1〜2文。である調。"),
      }),
    )
    .describe("マーケティングに使える切り口を4〜8件。互いに違う角度にする。"),
});
export type ProductAnalyzerOutput = z.infer<typeof ProductAnalyzerOutput>;

export interface ProductAnalyzerInput {
  product: Product;
  context: ProductContext;
  analysis: SaasAnalysis | null;
}

const SYSTEM_SUFFIX = `

あなたはSaaSのプロダクトマーケターである。上のProduct Contextと分析をもとに、
このプロダクトのマーケティングに使う「Product Knowledge Base」を作る。
${COMMON_RULES}
- Product Contextが人間の確認済みなら、それを最優先する。分析と食い違う場合もContextに従う。`;

function renderAnalysis(analysis: SaasAnalysis | null): string {
  if (!analysis) return "（詳細な分析はない。Product Contextのみを根拠にする）";
  const { overview, service, targetUsers, business, market, insights } = analysis;
  return [
    "# サイト分析",
    `一言で: ${overview.oneLiner}`,
    overview.description,
    `価値: ${service.valueProposition.items.join(" / ")}`,
    `機能: ${service.features.items.join(" / ")}`,
    `課題: ${service.problems.items.join(" / ")}`,
    `主なターゲット: ${targetUsers.primary.join(" / ")}`,
    `料金: ${business.pricing.value}（${business.pricing.status}）`,
    `類似サービス: ${market.similarServices.items.join(" / ")}`,
    `差別化: ${insights.differentiation.join(" / ")}`,
    `強み: ${insights.strengths.join(" / ")}`,
  ].join("\n");
}

export async function runProductAnalyzer(
  input: ProductAnalyzerInput,
  provider: LLMProvider,
): Promise<ProductAnalyzerOutput> {
  const { value } = await provider.completeStructured({
    kind: "extract",
    schemaName: "product_knowledge",
    schema: ProductAnalyzerOutput,
    system: renderContextSnapshot(input.product, input.context) + SYSTEM_SUFFIX,
    user: renderAnalysis(input.analysis),
  });
  return tidyKnowledge(value);
}

export function tidyKnowledge(value: ProductAnalyzerOutput): ProductAnalyzerOutput {
  return {
    ...value,
    usp: cleanList(value.usp, 6),
    useCases: cleanList(value.useCases, 6),
    features: cleanList(value.features, 10),
    marketingAngles: value.marketingAngles.filter((angle) => angle.name.trim()).slice(0, 8),
  };
}

/**
 * The knowledge base without a model: the four confirmed fields, placed where
 * they belong, and the analysis's lists where one exists. Thin — no angles are
 * invented — but it is true, and it lets every later screen render.
 */
export function knowledgeWithoutModel(context: ProductContext, analysis: SaasAnalysis | null): ProductAnalyzerOutput {
  return {
    summary: context.what,
    problem: context.why,
    solution: context.how,
    targetUser: context.who,
    usp: analysis ? cleanList(analysis.insights.differentiation, 6) : [],
    useCases: [],
    features: analysis ? cleanList(analysis.service.features.items, 10) : [],
    pricing: analysis?.business.pricing.value ?? "サイトに記載なし",
    marketingAngles: [],
  };
}
