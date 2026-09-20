import { z } from "zod";

/**
 * Product Fact: Grapeがプロダクトについて把握している情報の最小単位。
 *
 * マスタープロンプト§3の「Fact / Hypothesis の区別」を、UIではなくデータ層で保証するための型。
 * AIの推測を事実として保存しないよう、recordTypeを必須にしている。
 */

export const factCategories = ["problem", "value", "targetCustomer", "feature"] as const;
export type FactCategory = (typeof factCategories)[number];

export const factCategoryLabels: Record<FactCategory, string> = {
  problem: "解決する課題",
  value: "提供価値",
  targetCustomer: "ターゲット顧客",
  feature: "主な機能",
};

/**
 * - fact: サイト上に明記されている、または利用者自身が入力した確認済みの情報
 * - hypothesis: AIが読み取れた情報から推測したもの(未確認)
 * - unknown: 判断材料が無く、確定も推測もできなかったもの(空欄を埋めないための明示的な記録)
 */
export const recordTypes = ["fact", "hypothesis", "unknown"] as const;
export type RecordType = (typeof recordTypes)[number];

export const factSources = ["user", "ai"] as const;
export type FactSource = (typeof factSources)[number];

/** 手動で追加・編集するときの入力スキーマ。 */
export const productFactInputSchema = z.object({
  category: z.enum(factCategories, { message: "カテゴリを選択してください" }),
  content: z
    .string()
    .trim()
    .min(1, "内容を入力してください")
    .max(500, "内容は500文字以内で入力してください"),
  recordType: z.enum(recordTypes, { message: "種別を選択してください" }),
});

export type ProductFactInput = z.infer<typeof productFactInputSchema>;

export function parseProductFactInput(raw: unknown) {
  return productFactInputSchema.safeParse(raw);
}

/**
 * AIに返させる構造。
 *
 * 各項目に evidence(根拠)を必須で持たせ、recordTypeが hypothesis / unknown の場合でも
 * 「なぜそう判断したか」を保存できるようにしている(マスタープロンプト§9「根拠を保存する」)。
 */
export const aiFactSchema = z.object({
  category: z.enum(factCategories),
  content: z.string(),
  recordType: z.enum(recordTypes),
  evidence: z.string(),
});

export const aiAnalysisSchema = z.object({
  facts: z.array(aiFactSchema),
});

export type AiFact = z.infer<typeof aiFactSchema>;
export type AiAnalysis = z.infer<typeof aiAnalysisSchema>;
