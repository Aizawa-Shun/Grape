import { Callout } from "@/components/ui/callout";

/** Shown when the server has no Firebase web config to hand the browser. */
export function FirebaseNotConfigured() {
  return (
    <Callout tone="attention" title="Firebaseの設定が見つかりません">
      サーバーに FIREBASE_WEBAPP_CONFIG が設定されていません。App Hosting では自動で入ります。
      ローカルでは Firebase コンソールのプロジェクト設定からWebアプリの設定をコピーして .env に書くか、
      <code className="font-mono">pnpm dev:emulators</code> でエミュレーターを使ってください。
    </Callout>
  );
}
