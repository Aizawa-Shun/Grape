import { Card } from "@/components/ui/card";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { hasLlmApiKeys } from "@/core/auth/users";
import { requireUser } from "@/server/auth/current-user";
import { clientAuthSettings } from "@/server/auth/firebase-web";

import { PasswordResetForm, ProfileForm } from "./account-form";
import { LlmKeyForm } from "./llm-key-form";

export const dynamic = "force-dynamic";

/**
 * The account as Grape sees it: a display name of its own, a sign-in identity
 * that belongs to Firebase Authentication, and the API keys this person pays
 * for their AI calls with.
 *
 * Still absent, and deliberately: deleting the account. On a self-hosted
 * instance the owner's account is what everything else hangs off, and a button
 * that can strand a running Grape with no way back in is not worth the
 * symmetry.
 */
export default async function AccountPage() {
  const user = await requireUser();
  const llmKeyStatus = await hasLlmApiKeys(user.id);
  const settings = clientAuthSettings();

  // Which ways this account can sign in, from Firebase itself: a Google-only
  // account has no password to reset, and offering it one would be a form
  // that explains nothing when it fails.
  const { firebaseAuth } = await import("@/db/firebase");
  const record = await firebaseAuth()
    .getUser(user.id)
    .catch(() => null);
  const hasPassword = record?.providerData.some((provider) => provider.providerId === "password") ?? false;

  return (
    <Page>
      <PageHeader
        title="アカウント"
        description="ログインに使う情報です。メールアドレスとパスワードは Firebase Authentication が管理しています。"
      />

      <Section
        title="あなたの情報"
        description={
          user.role === "owner" ? "このGrapeのオーナーです。" : "メンバーとして参加しています。"
        }
      >
        <Card>
          <ProfileForm displayName={user.displayName} email={user.email} />
        </Card>
      </Section>

      <Section title="パスワード">
        <Card>
          {hasPassword && settings ? (
            <PasswordResetForm email={user.email} settings={settings} />
          ) : (
            <p className="text-sm text-text-muted">
              Googleアカウントでログインしています。パスワードは設定されていません。
            </p>
          )}
        </Card>
      </Section>

      <Section
        title="AIのAPIキー"
        description="診断・タスクの提案・文面の作成でAIを呼ぶときに使う、あなた自身のキーです。/settingsでどのサービスを使うか選んだうえで、ここにキーを設定してください。ここだけはGrapeの外——選んだAI事業者——に送られます。"
      >
        <Card>
          <LlmKeyForm status={llmKeyStatus} />
        </Card>
      </Section>
    </Page>
  );
}
