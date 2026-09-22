import { z } from "zod";

/**
 * LLM設定の入力スキーマ。
 *
 * APIキーは空文字での送信を「削除」として扱うため必須にしない
 * (保存層で空文字を null に正規化する)。
 */
export const settingsInputSchema = z.object({
  anthropicApiKey: z
    .string()
    .trim()
    .max(200, "APIキーが長すぎます")
    .optional(),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;

export function parseSettingsInput(raw: unknown) {
  return settingsInputSchema.safeParse(raw);
}
