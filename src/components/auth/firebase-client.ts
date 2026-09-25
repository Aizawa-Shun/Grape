"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth, type User } from "firebase/auth";

import type { ClientAuthSettings } from "@/server/auth/firebase-web";

/**
 * The browser's Firebase Auth instance, created once per page load from the
 * config the server passed down (see server/auth/firebase-web.ts).
 *
 * The client SDK is used for signing in and nothing else. Firestore is never
 * touched from the browser — every read and write goes through Grape's own
 * server — which is why firestore.rules denies everything.
 */
let cached: Auth | null = null;

export function clientAuth(settings: ClientAuthSettings): Auth {
  if (cached) return cached;
  const app = getApps().length ? getApp() : initializeApp(settings.config);
  const auth = getAuth(app);
  if (settings.emulatorHost) {
    connectAuthEmulator(auth, `http://${settings.emulatorHost}`, { disableWarnings: true });
  }
  cached = auth;
  return auth;
}

/**
 * Hands a freshly signed-in Firebase user to Grape, which lets the account in
 * (or refuses it) and sets the session cookie. Returns the error to show,
 * or null on success.
 *
 * The browser's own Firebase sign-in state is dropped afterwards either way:
 * the session cookie is what Grape runs on, and keeping a second, separate
 * signed-in state in IndexedDB would make "ログアウト" mean two things.
 */
export async function establishSession(
  auth: Auth,
  user: User,
  inviteCode?: string,
): Promise<string | null> {
  const idToken = await user.getIdToken(true);
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken, ...(inviteCode ? { inviteCode } : {}) }),
  });
  const body = await response.json().catch(() => ({}));
  await auth.signOut().catch(() => undefined);
  return response.ok ? null : (body.error ?? "ログインできませんでした。");
}

/** Firebase's error codes, in the words the rest of the app uses. */
export function describeFirebaseError(error: unknown): string {
  const code = (error as { code?: string }).code ?? "";
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "メールアドレスかパスワードが違います。";
    case "auth/email-already-in-use":
      return "そのメールアドレスはすでに登録されています。ログインしてください。";
    case "auth/weak-password":
      return "パスワードが短すぎます。もっと長くしてください。";
    case "auth/too-many-requests":
      return "試行回数が多すぎます。しばらく待ってから、もう一度お試しください。";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Googleでのログインが途中で閉じられました。";
    case "auth/popup-blocked":
      return "ポップアップがブロックされました。ブラウザの設定で許可してから、もう一度お試しください。";
    case "auth/network-request-failed":
      return "通信に失敗しました。接続を確かめて、もう一度お試しください。";
    default:
      return "ログインできませんでした。もう一度お試しください。";
  }
}
