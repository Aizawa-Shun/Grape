import { z } from "zod";
import { recordTypes } from "@/lib/validation/product-fact";

/**
 * Market Insight: 市場・顧客・競合についてGrapeが把握している情報の最小単位。
 *
 * Product Fact(Phase 3)と同じく fact / hypothesis / unknown を必須にするが、
 * 市場情報は外部の一次情報に基づくため、情報源URLと取得日時を持てるようにしている
 * (マスタープロンプト§Phase 4「情報源・取得日時を必須で紐付け」)。
 */

export const insightCategories = [
  "targetCustomer",
  "customerProblem",
  "competitor",
  "channel",
] as const;
export type InsightCategory = (typeof insightCategories)[number];

export const insightCategoryLabels: Record<InsightCategory, string> = {
  targetCustomer: "ターゲット顧客",
  customerProblem: "顧客の課題",
  competitor: "競合・代替手段",
  channel: "顧客が情報を探す場所",
};

export const insightCategoryHints: Record<InsightCategory, string> = {
  targetCustomer: "どんな人が、どんな状況で使うか",
  customerProblem: "その人たちが実際に困っていること",
  competitor: "今その課題をどう解決しているか(競合サービス・代替手段)",
  channel: "その人たちが情報収集している場所(コミュニティ、SNS、検索など)",
};

/** 手動で追加・編集するときの入力スキーマ。 */
export const marketInsightInputSchema = z.object({
  category: z.enum(insightCategories, { message: "カテゴリを選択してください" }),
  content: z
    .string()
    .trim()
    .min(1, "内容を入力してください")
    .max(500, "内容は500文字以内で入力してください"),
  recordType: z.enum(recordTypes, { message: "種別を選択してください" }),
  // 空文字は「未入力」として許容する(保存層で undefined に正規化する)。
  // .transform() を後段に置くと出力型のキーが必須化されるため、.optional() を最後にしている。
  sourceUrl: z
    .string()
    .trim()
    .max(2000, "URLが長すぎます")
    .refine(
      (v) => v === "" || /^https?:\/\//.test(v),
      "URLは http:// または https:// で始めてください"
    )
    .optional(),
});

export type MarketInsightInput = z.infer<typeof marketInsightInputSchema>;

export function parseMarketInsightInput(raw: unknown) {
  return marketInsightInputSchema.safeParse(raw);
}

/**
 * 構造化パスでAIに返させる形式。
 *
 * sourceUrl / sourceTitle は Web検索で実際に参照したページを指す。
 * 検索で裏付けが取れなかった項目は recordType を hypothesis / unknown にし、
 * sourceUrl を空にすることを許容する(存在しない情報源を捏造させないため)。
 */
export const aiInsightSchema = z.object({
  category: z.enum(insightCategories),
  content: z.string(),
  recordType: z.enum(recordTypes),
  evidence: z.string(),
  sourceUrl: z.string(),
  sourceTitle: z.string(),
});

export const aiResearchSchema = z.object({
  insights: z.array(aiInsightSchema),
});

export type AiInsight = z.infer<typeof aiInsightSchema>;
