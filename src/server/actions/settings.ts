"use server";

import { revalidatePath } from "next/cache";
import { saveLlmSettings } from "@/server/firebase/settings";
import { parseSettingsInput } from "@/lib/validation/settings";
import type { SettingsActionState } from "@/server/actions/settings-types";

/** LLM(Anthropic)のAPIキーを保存する。空欄で送信すると削除される。 */
export async function saveLlmApiKey(
  _prevState: SettingsActionState,
  formData: FormData
): Promise<SettingsActionState> {
  const parsed = parseSettingsInput(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { status: "error", message: "入力内容を確認してください。" };
  }

  await saveLlmSettings({ anthropicApiKey: parsed.data.anthropicApiKey });
  revalidatePath("/settings");

  return {
    status: "success",
    message: parsed.data.anthropicApiKey ? "APIキーを保存しました。" : "APIキーを削除しました。",
  };
}
