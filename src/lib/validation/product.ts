import { z } from "zod";

/**
 * URLの前処理: スキーム(http/https)が無い入力("example.com"等)を許容し、
 * https:// を補って検証する。ユーザーが毎回 "https://" を打つ手間を減らすため。
 */
function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Product登録・編集フォームの入力検証スキーマ。
 *
 * ここで保存する値はすべてユーザーが直接入力した Fact として扱う
 * (docs/architecture.md の Fact/Hypothesis区別の方針に基づく)。
 */
export const productInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "プロダクト名を入力してください")
    .max(100, "100文字以内で入力してください"),
  url: z
    .string()
    .trim()
    .min(1, "URLを入力してください")
    .transform(normalizeUrl)
    .pipe(z.url("有効なURLを入力してください(例: https://example.com)")),
  description: z
    .string()
    .trim()
    .min(1, "サービス概要を入力してください")
    .max(2000, "2000文字以内で入力してください"),
  targetCustomer: z
    .string()
    .trim()
    .min(1, "想定顧客を入力してください")
    .max(1000, "1000文字以内で入力してください"),
  problem: z
    .string()
    .trim()
    .min(1, "解決する課題を入力してください")
    .max(1000, "1000文字以内で入力してください"),
});

export type ProductInput = z.infer<typeof productInputSchema>;

/** フォームの生入力(FormData由来の文字列群)から検証済みの値を取り出す。 */
export function parseProductInput(raw: Record<string, unknown>) {
  return productInputSchema.safeParse(raw);
}
