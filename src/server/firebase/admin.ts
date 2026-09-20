import { cert, initializeApp, applicationDefault, getApps, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Firebase Admin SDK(サーバー専用)の初期化。
 *
 * Grapeはクライアント(ブラウザ)からFirestoreへ直接アクセスしない
 * (firestore.rules で全拒否)。すべての読み書きはこのAdmin SDK経由、
 * つまり Server Actions / Server Components からのみ行う。
 *
 * 認証方式:
 * - Firebase App Hosting(本番): Application Default Credentials(ADC)。
 *   App Hosting のサービスアカウント `firebase-app-hosting-compute@...` が
 *   roles/firebase.sdkAdminServiceAgent で自動的に Firestore へのアクセス権を持つ
 * - ローカル開発(FIRESTORE_EMULATOR_HOST 設定時): ダミーの認証情報を使う。
 *   `applicationDefault()` はGCEメタデータサーバへの到達を試みるため、
 *   クラウド上で実行していないローカル環境では毎回タイムアウト(数十秒)し、
 *   全リクエストが極端に遅くなる。エミュレータはそもそも認証情報の中身を
 *   検証しないため、ネットワークアクセスを伴わない固定のダミー鍵で十分。
 */
const EMULATOR_CREDENTIAL = cert({
  projectId: "demo-grape",
  clientEmail: "emulator@demo-grape.iam.gserviceaccount.com",
  privateKey:
    "-----BEGIN PRIVATE KEY-----\n" +
    "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDghg38vlEmSVlP\n" +
    "b4yjnwqCUJ7E+TI06LllnFAvPDwbUKqexT0XXho141YPMV7jvT9K9scT324swvQE\n" +
    "2MnFd2SE7xCMHEYIcgiBUsk0iPzsYbl5EfdJU5/blxI9LaHAoCpVf+R1u/vr1ik6\n" +
    "rRtLwT2cUj8EiZTbqYNbJ9e2xGiMqTfgXWTe/VWzDC7t773K3nGvf8nipVEkOuLE\n" +
    "nPugD29HftsiGgqx4AhigwdNwu15GhnRVv3QZ+COShDRMUzHg25IWvDAxaiXmJvc\n" +
    "4podcTROHsG6o0m7lpPWuikfI+tv06YYJFMCGp3/mYWwg/rU9XewbdQ/byfe0Zqh\n" +
    "tLl3tP8VAgMBAAECggEANcZVtkmc5QcfUWO9svimCzUk+bdXm417zgbku5N5L++f\n" +
    "ldxWt/CNZYe39naULAaJELrPToaufCELUdfcZ6OjWyVo+K3S5jXtrI+36hG/RhxX\n" +
    "0FQJvrG9MVpa/3Uc7yZNTWIOxVYLTd5izI9mYLv9NiIKvtr24K+WavA9faRICBwS\n" +
    "khT3SoRVAfKoBetcx7bkM15dkLqMFxsURxv0VkwMioZgmSP9cqMn8kXA7nR0xCNz\n" +
    "csUCmJkImBzVUp7omEcoYr4TX5YnGX5JILvnNYTRpp/bmv7q13yiWry6MYzv8aSU\n" +
    "RHuaoLKaTnFk2zmhHVpZbxPvxni1iN771O18geHW4QKBgQDxS/jCb0alAC61ShSN\n" +
    "8BgG619EuLwC7Y2TELxGiCvkG8SIBvoQm5FcX7l4gpi2GSt6tXCtkKWaA5VbSaT2\n" +
    "S2MGE4QNQoU4gQRybKIJNnO3UNYlsmxvrH3YQT3CYD/rL+FUAe/eBHWy3EKMYqjs\n" +
    "849OxAIinAsVHJlw0lYEQkpiZQKBgQDuNG+z1ri6fv2SjSfJ7Y1xEMFpxUXGQZXP\n" +
    "umXRMssCQreba+EaVCSAr6vphOwbS+7r/N0VpdIgCHPKbCtNPhkSxXrLwJLFzLlB\n" +
    "a8ybeu6YUyb9/RECMJJtfRX2nT4FR6kX0gzW+PnZd1JSH30GcZUmj1Idc+w5Scps\n" +
    "JEV2ReAG8QKBgQC0BCaxAA1nOcye6YaOIen694xam6uAT7OIXTrpL9v20RR9Gx9i\n" +
    "Vn1KuguHsX62k+6RHF3Uzw4M6dF6imWsba+Rr+ubbN4wumgT6aG1V89ams84znUB\n" +
    "l2FHfdzSb7YgAteLMeq+6vrYFmT7kPtP06E9dRPWuC24cV60Aee0Q7R01QKBgGQt\n" +
    "tVSi1ynHwojhyHwJ5dRJQa5kAsYwSvsD31It1Gbs/B7nLdJO1NMyDlC1UD7inmas\n" +
    "/6XdCRPjuh7FgyiHFzBn0Q7jvFZnlPnIhlJVTwbM4bcruP18w/g8BQKkerLpwll8\n" +
    "Q14dc6ZboklbaM9O8XU4DUbJu+0T9YepcXUeSethAoGABrM4h3gjxmTJsUefD9AR\n" +
    "ukLygiWrU7ih8rPH03BaYJRnXYIPU7SPAHnpCeZyPh0ZEhDczO07hN9e4IASrB0Z\n" +
    "uI15zh7tR6N4pcH3MEfBT1N16oaEb+qRzPVM36rt+0rMq2cdBXbZqZswftCwh4an\n" +
    "BYxiFjoJKgZOtEIgPHluJcY=\n" +
    "-----END PRIVATE KEY-----\n",
});

function createApp(): App {
  if (getApps().length > 0) {
    return getApps()[0]!;
  }

  const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  const projectId = process.env.FIREBASE_PROJECT_ID || "grape-growth-os";

  return initializeApp({
    projectId,
    credential: isEmulator ? EMULATOR_CREDENTIAL : applicationDefault(),
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
