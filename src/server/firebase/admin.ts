import { initializeApp, getApps, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Firebase Admin SDK(サーバー専用)の初期化。
 *
 * Grapeはクライアント(ブラウザ)からFirestoreへ直接アクセスしない
 * (firestore.rules で全拒否)。すべての読み書きはこのAdmin SDK経由、
 * つまり Server Actions / Server Components からのみ行う。
 *
 * 認証方式:
 * - Firebase App Hosting: Application Default Credentials(ADC)
 *   App Hosting のサービスアカウント `firebase-app-hosting-compute@...`
 *   が roles/firebase.sdkAdminServiceAgent で自動的に Firestore へのアクセス権を持つ
 * - ローカル開発: FIRESTORE_EMULATOR_HOST が設定されていればエミュレータを使用
 * - その他のサーバー環境: gcloud auth application-default login で認証
 *
 * 秘密鍵を環境変数に保存しないため安全で、デプロイ環境ごとに異なる認証方式に対応。
 */
function createApp(): App {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || "grape-growth-os";

  return initializeApp({
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
