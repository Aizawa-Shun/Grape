import type { Firestore } from "firebase-admin/firestore";
import { getDb } from "@/server/firebase/admin";

/**
 * アプリ全体で共有するLLM設定。
 *
 * プロダクト単位ではなく `settings/llm` の単一ドキュメントに保存する
 * (現時点ではAnthropicのAPIキーのみ)。
 */

const COLLECTION = "settings";
const DOC_ID = "llm";

export interface LlmSettings {
  anthropicApiKey?: string;
  updatedAt?: Date;
}

function ref(db: Firestore) {
  return db.collection(COLLECTION).doc(DOC_ID);
}

/** 現在の設定を取得する。未設定なら空オブジェクト。 */
export async function getLlmSettings(db: Firestore = getDb()): Promise<LlmSettings> {
  const snapshot = await ref(db).get();
  const data = snapshot.data();
  if (!data) {
    return {};
  }
  return {
    anthropicApiKey: data.anthropicApiKey ?? undefined,
    updatedAt: data.updatedAt ? data.updatedAt.toDate() : undefined,
  };
}

/** APIキーを保存する。空文字/undefinedを渡すと削除扱いになる。 */
export async function saveLlmSettings(
  input: { anthropicApiKey?: string },
  db: Firestore = getDb()
): Promise<void> {
  await ref(db).set(
    {
      anthropicApiKey: input.anthropicApiKey || null,
      updatedAt: new Date(),
    },
    { merge: true }
  );
}
