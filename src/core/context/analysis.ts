import { z } from "zod";

/**
 * The shape of a SaaS analysis: what a model produces after reading a site,
 * and what the product page renders.
 *
 * Two things separate this from the four-field Product Context it sits beside.
 *
 * First, every claim carries its own standing. The old extraction had one
 * answer per question and one sentinel — "サイト上に明示なし" — for everything
 * else, which meant a site that merely failed to spell out its audience
 * produced four screens' worth of "not stated" and nothing a reader could use.
 * A claim here says whether it was read off the page (`confirmed`), worked out
 * from what the page does say (`inferred`), or genuinely could not be
 * established (`unknown`) — so an inference can be shown without being passed
 * off as fact, which is the whole reason it is safe to infer at all.
 *
 * Second, claims cite. `evidence` ties an answer back to the URL, the sentence
 * on it, and why the model read that sentence the way it did. Without that,
 * "誰向け: チェス初心者" is an assertion the reader has to take or leave; with
 * it, they can check it in one click and correct it.
 *
 * Every field is required, with no optionals or nullables anywhere: the
 * provider adapters close and fully-require the JSON Schema they send (see
 * core/llm/json-schema.ts), because OpenAI's strict mode rejects anything
 * looser. "Nothing to say" is expressed as an empty array or an `unknown`
 * claim, never as an absent key.
 */

export const CLAIM_STATUSES = ["confirmed", "inferred", "unknown"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const status = z
  .enum(CLAIM_STATUSES)
  .describe(
    "confirmed=サイトに明記されている / inferred=サイトの記述から推定した / unknown=サイトからは判断できない",
  );

/** One answer, with how firmly the site supports it. */
const TextClaim = z.object({
  value: z.string().describe("日本語の答え。unknown のときは空文字にせず「未確認」と書く。"),
  status,
});

/** A list answer. `items` is empty exactly when `status` is unknown. */
const ListClaim = z.object({
  items: z.array(z.string()).describe("日本語の項目。推測で埋めず、無ければ空配列。"),
  status,
});

export type TextClaim = z.infer<typeof TextClaim>;
export type ListClaim = z.infer<typeof ListClaim>;

export const SaasAnalysisSchema = z.object({
  overview: z.object({
    oneLiner: z
      .string()
      .describe("このサービスを一言で。40字以内。例: オンラインでチェスを楽しめるWebサービス"),
    description: z.string().describe("2〜3文の概要。サイトが使っている言葉を尊重する。"),
    category: z.string().describe("サービスカテゴリ。例: Gaming / Education"),
  }),

  service: z.object({
    what: TextClaim.describe("何をするサービスか"),
    who: TextClaim.describe("誰向けのサービスか"),
    problems: ListClaim.describe("このサービスが解決する課題"),
    valueProposition: ListClaim.describe("利用者に提供している価値"),
    features: ListClaim.describe("主な機能。サイトで確認できるものを優先し、無い機能を作らない。"),
    usage: TextClaim.describe("使い始め方・使い方"),
  }),

  targetUsers: z.object({
    primary: z.array(z.string()).describe("主なターゲット。1〜3件。"),
    secondary: z.array(z.string()).describe("次点のターゲット。無ければ空配列。"),
    status,
  }),

  business: z.object({
    pricing: TextClaim.describe("料金。金額やプランがサイトにあればそのまま。"),
    model: TextClaim.describe("ビジネスモデル・課金方式。例: フリーミアム、月額サブスクリプション"),
    audienceType: TextClaim.describe("B2B / B2C / B2B2C のいずれか、または未確認"),
    revenueSource: TextClaim.describe("想定される収益源"),
  }),

  market: z.object({
    category: TextClaim.describe("市場カテゴリ"),
    industry: TextClaim.describe("属する業界"),
    /**
     * Named "similar" rather than "competitors" throughout, because the model
     * is being asked which services resemble this one — a judgment it can make
     * from the page — not which ones it actually competes with, which it
     * cannot know and must not assert.
     */
    similarServices: ListClaim.describe(
      "類似サービス・競合候補。断定せず、思い当たらなければ空配列。",
    ),
  }),

  insights: z.object({
    strengths: z.array(z.string()).describe("このサービスの強み"),
    differentiation: z.array(z.string()).describe("差別化ポイント"),
    userNeeds: z.array(z.string()).describe("想定されるユーザーニーズ"),
    opportunities: z.array(z.string()).describe("今後の可能性"),
  }),

  evidence: z
    .array(
      z.object({
        /** Which claim this backs, by its key — see EVIDENCE_TOPICS. */
        topic: z.string().describe("対象の項目キー。例: service.who, business.pricing"),
        url: z.string().describe("根拠にしたページのURL"),
        quote: z.string().describe("根拠にしたページ上の文章。原文のまま。"),
        reasoning: z.string().describe("その文章からそう判断した理由。1文。"),
      }),
    )
    .describe("主要な項目には可能な限り根拠を付ける。"),

  primaryLanguage: z.string().describe("サイト本文の主要言語のBCP-47コード。例: ja, en"),
});

export type SaasAnalysis = z.infer<typeof SaasAnalysisSchema>;
export type AnalysisEvidence = SaasAnalysis["evidence"][number];

/**
 * The topic keys the model is told to cite against, and the UI groups by.
 *
 * A plain string in the schema rather than an enum: a model that invents
 * `service.pricing` should still have its evidence stored and shown under the
 * nearest heading rather than failing the whole extraction over a key name.
 * `evidenceFor` below does that matching loosely on purpose.
 */
export const EVIDENCE_TOPICS = [
  "overview",
  "service.what",
  "service.who",
  "service.problems",
  "service.valueProposition",
  "service.features",
  "service.usage",
  "targetUsers",
  "business.pricing",
  "business.model",
  "business.audienceType",
  "business.revenueSource",
  "market.category",
  "market.industry",
  "market.similarServices",
] as const;

/** Evidence whose topic is, or sits under, `topic` — so "business" collects every business.* citation. */
export function evidenceFor(analysis: SaasAnalysis, topic: string): AnalysisEvidence[] {
  return analysis.evidence.filter(
    (item) => item.topic === topic || item.topic.startsWith(`${topic}.`),
  );
}
