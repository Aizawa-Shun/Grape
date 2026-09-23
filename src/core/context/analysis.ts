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
 * looser. "Nothing to say" is expressed as an `unknown` claim — never as an
 * absent key, and no longer as a blank value or an empty list either. A
 * reader who opens this page wants an answer to every question on it; what
 * they need alongside the answer is how far to trust it, which is `status`'s
 * job and not the empty string's.
 *
 * Third, and downstream of the same idea: `assessment` scores where the
 * product stands today on six axes a site can be judged on, so the page ends
 * with something to act on rather than a description that stops.
 */

export const CLAIM_STATUSES = ["confirmed", "inferred", "unknown"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const status = z
  .enum(CLAIM_STATUSES)
  .describe(
    "confirmed=サイトに明記されている / inferred=サイトの記述から推定した / unknown=サイトからは判断できない",
  );

/**
 * One answer, with how firmly the site supports it.
 *
 * `value` is always written, `status` alone says how much to trust it — the
 * two are independent, and conflating them is what made the old extraction
 * useless. A field that came back blank taught the reader nothing: neither
 * what the service probably is, nor that the site failed to say. A filled
 * answer with an `unknown` badge teaches both, and the badge is what keeps the
 * reading from being passed off as fact.
 */
const TextClaim = z.object({
  value: z
    .string()
    .describe(
      "日本語の答え。1〜3文（60〜200字程度）で、読んだ人がそれだけで分かる具体さで書く。" +
        "空文字・「未確認」・「不明」だけの回答は禁止。サイトに書かれていない項目でも、" +
        "ページの手がかりから最も妥当な読みを書き、確度は status で示す。文体はである調。",
    ),
  status,
});

/**
 * A list answer. `items` is never empty: the same rule as TextClaim — how
 * firmly the site supports the list is `status`'s job, not the length's.
 */
const ListClaim = z.object({
  items: z
    .array(z.string())
    .describe(
      "日本語の項目を3〜5件。各項目は1文（20〜60字程度）で具体的に書く。" +
        "空配列は禁止。サイトに明記が無ければ、ページの手がかりから妥当な読みを挙げ、" +
        "確度は status で示す。文体はである調。",
    ),
  status,
});

/**
 * 1–5, rounded and clamped rather than rejected.
 *
 * Same rescue as `confidence` in extract.ts: a model that answers `7` or `3.5`
 * to a five-point question has understood the question and mis-typed the
 * answer, and failing the whole analysis over it would throw away a crawl and
 * six other scores that were fine.
 */
const scoreOutOfFive = z.preprocess(
  (value) => (typeof value === "number" ? Math.min(5, Math.max(1, Math.round(value))) : value),
  z.number().int().min(1).max(5),
);

/** One axis of the scorecard: the number, and why it is that number. */
const AxisScore = z.object({
  score: scoreOutOfFive.describe(
    "1〜5の整数。1=ほぼ手つかず、2=弱い、3=ふつう、4=よくできている、5=言うことがない。" +
      "根拠が無いまま高く付けない。",
  ),
  comment: z
    .string()
    .describe(
      "その点数にした理由。1〜2文（40〜120字程度）。ページ上の何を見てそう判断したかを書く。文体はである調。",
    ),
});

export type TextClaim = z.infer<typeof TextClaim>;
export type ListClaim = z.infer<typeof ListClaim>;

/**
 * The scorecard's axes, in the order they are asked for and rendered.
 *
 * Six things a crawled site can actually be judged on, chosen so that each one
 * is answerable from the pages alone and each one is fixable by the person
 * reading it. Nothing here asks about traffic, retention or revenue: those are
 * the funnel's to measure, and a model reading a landing page cannot know
 * them. This is the state of the *site's case for the product*, which is
 * exactly what a service with no visitors yet can still act on.
 *
 * A fixed key per axis rather than an array of `{key, score}`: providers close
 * and fully require every object in the schema (core/llm/json-schema.ts), so
 * six named fields cannot come back short, duplicated or reordered, and the UI
 * never has to handle a missing axis.
 */
export const ASSESSMENT_AXES = [
  {
    key: "clarity",
    label: "価値の明確さ",
    question: "何をするサービスか、開いて数秒で分かるか",
  },
  {
    key: "audience",
    label: "ターゲットの具体性",
    question: "誰のためのものか、具体的に書かれているか",
  },
  {
    key: "differentiation",
    label: "差別化の伝わりやすさ",
    question: "他の手段ではなくこれを選ぶ理由が示されているか",
  },
  {
    key: "credibility",
    label: "信頼の裏づけ",
    question: "実績・事例・運営者情報など、信じてよい手がかりがあるか",
  },
  { key: "action", label: "次の行動への導線", question: "迷わず次の一歩に進めるか" },
  { key: "monetization", label: "収益への道筋", question: "料金や課金の形が分かるか" },
] as const;

export type AssessmentAxisKey = (typeof ASSESSMENT_AXES)[number]["key"];

export const SaasAnalysisSchema = z.object({
  overview: z.object({
    oneLiner: z
      .string()
      .describe("このサービスを一言で。40字以内。例: オンラインでチェスを楽しめるWebサービス"),
    description: z
      .string()
      .describe(
        "3〜4文（150〜300字程度）の概要。何をするもので、誰の何を解決し、どう使うのかが" +
          "この段落だけで分かるように書く。サイトが使っている言葉を尊重する。文体はである調。",
      ),
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
    primary: z
      .array(z.string())
      .describe("主なターゲット。2〜3件。「開発者」で止めず、状況まで書く。文体はである調。"),
    secondary: z
      .array(z.string())
      .describe("次点のターゲット。1〜3件。主なターゲットと重複させない。文体はである調。"),
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
      "類似サービス・競合候補を2〜4件。断定は避け、「〜に近い」「〜の代替になりうる」と書く。" +
        "実在するサービス名を挙げ、思い当たらない場合は代替手段（手作業・既存ツールなど）を挙げる。",
    ),
  }),

  insights: z.object({
    strengths: z.array(z.string()).describe("このサービスの強み。3〜4件。文体はである調。"),
    differentiation: z.array(z.string()).describe("差別化ポイント。2〜4件。文体はである調。"),
    userNeeds: z
      .array(z.string())
      .describe("想定されるユーザーニーズ。3〜4件。文体はである調。"),
    opportunities: z.array(z.string()).describe("今後の可能性。3〜4件。文体はである調。"),
  }),

  /**
   * The scorecard. Judgment throughout — it is rendered under its own heading
   * that says so, beside the evidence-backed claims above rather than among
   * them.
   */
  assessment: z.object({
    clarity: AxisScore.describe("価値の明確さ: 何をするサービスか、開いて数秒で分かるか"),
    audience: AxisScore.describe("ターゲットの具体性: 誰のためのものかが具体的に書かれているか"),
    differentiation: AxisScore.describe(
      "差別化の伝わりやすさ: 他の手段ではなくこれを選ぶ理由が示されているか",
    ),
    credibility: AxisScore.describe(
      "信頼の裏づけ: 実績・事例・運営者情報など、信じてよい手がかりがあるか",
    ),
    action: AxisScore.describe("次の行動への導線: 迷わず次の一歩に進めるか"),
    monetization: AxisScore.describe("収益への道筋: 料金や課金の形が分かるか"),
    summary: z
      .string()
      .describe(
        "総評。3〜4文（150〜300字程度）。いまの到達点と、伸びしろがどこにあるかを書く。文体はである調。",
      ),
    priority: z
      .string()
      .describe(
        "いま最初に手を入れるべき一点。1〜2文（40〜120字程度）。点数が最も低い軸と食い違わせない。文体はである調。",
      ),
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
export type SaasAssessment = SaasAnalysis["assessment"];

/** One plotted row: the axis, its number, and the sentence behind the number. */
export interface AssessmentRow {
  key: AssessmentAxisKey;
  label: string;
  question: string;
  score: number;
  comment: string;
}

export const ASSESSMENT_MAX_SCORE = 5;

/**
 * The stored analysis's scorecard, or null when there is not one.
 *
 * `product_contexts.analysis` is a `$type<SaasAnalysis>()` cast over a JSON
 * column — nothing revalidates it on the way out — so every row written before
 * this field existed claims at the type level to have an assessment and does
 * not have one at runtime. Checked here, once, rather than left for the first
 * `.score` access to crash a page that rendered fine yesterday.
 */
export function assessmentOf(analysis: SaasAnalysis): SaasAssessment | null {
  const assessment = analysis.assessment as SaasAssessment | undefined;
  if (!assessment) return null;

  const complete = ASSESSMENT_AXES.every(
    ({ key }) => typeof assessment[key]?.score === "number",
  );
  return complete ? assessment : null;
}

/** The axes in their fixed order, ready to plot. */
export function assessmentRows(assessment: SaasAssessment): AssessmentRow[] {
  return ASSESSMENT_AXES.map(({ key, label, question }) => ({
    key,
    label,
    question,
    score: assessment[key].score,
    comment: assessment[key].comment,
  }));
}

/** Mean of the six axes, to one decimal — the figure the scorecard leads with. */
export function overallScore(assessment: SaasAssessment): number {
  const rows = assessmentRows(assessment);
  const total = rows.reduce((sum, row) => sum + row.score, 0);
  return Math.round((total / rows.length) * 10) / 10;
}

/**
 * The axis to put the emphasis on: the lowest score, earliest axis winning a
 * tie. One, never a set — the whole point of highlighting it is that it is the
 * next thing to work on, and "these three are equally weakest" is not an
 * answer anyone can act on.
 */
export function weakestAxisKey(assessment: SaasAssessment): AssessmentAxisKey {
  return assessmentRows(assessment).reduce((weakest, row) =>
    row.score < weakest.score ? row : weakest,
  ).key;
}

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
