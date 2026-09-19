import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Firebase Admin SDK(サーバー専用)の初期化。
 *
 * Grapeはクライアント(ブラウザ)からFirestoreへ直接アクセスしない
 * (firestore.rules で全拒否)。すべての読み書きはこのAdmin SDK経由、
 * つまり Server Actions / Server Components からのみ行う。
 *
 * ローカル開発では `FIRESTORE_EMULATOR_HOST` が設定されていれば
 * firebase-admin が自動的にエミュレータへ接続する(本ファイルでの分岐は不要)。
 */
function createApp(): App {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Firebase の認証情報が設定されていません。.env.local に " +
        "FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY を設定してください。"
    );
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  });
}

let firestoreSingleton: Firestore | undefined;

/** サーバー側で使うFirestoreクライアント(シングルトン)。 */
export function getDb(): Firestore {
  if (!firestoreSingleton) {
    firestoreSingleton = getFirestore(createApp());
  }
  return firestoreSingleton;
}
