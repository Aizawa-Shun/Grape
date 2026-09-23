import { Card } from "@/components/ui/card";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { hasLlmApiKeys } from "@/core/auth/users";
import { requireUser } from "@/server/auth/current-user";
import { hasPassword } from "@/server/auth/password";

import { PasswordForm, ProfileForm } from "./account-form";
import { LlmKeyForm } from "./llm-key-form";

export const dynamic = "force-dynamic";

/**
 * This page existed once as a placeholder that said "not built yet", and was
 * deleted for describing a product shape the architecture ruled out: there was
 * no user table to hold a profile. There is one now — name, address and a
 * scrypt hash — so every field here writes to a real column, which is the only
 * condition on which it comes back.
 *
 * Still absent, and deliberately: deleting the account. On a self-hosted
 * instance the owner's account is what everything else hangs off, and a button
 * that can strand a running Grape with no way back in is not worth the
 * symmetry.
 */
export default async function AccountPage() {
  const user = await requireUser();
  const llmKeyStatus = await hasLlmApiKeys(user.id);

  return (
    <Page>
      <PageHeader
        title="アカウント"
        description="ログインに使う情報です。名前・メール・パスワードはこのGrapeの中だけで完結していて、どこにも送られません。"
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

      {hasPassword(user.passwordHash) ? (
        <Section title="パスワード" description="変えるには、いま使っているパスワードが要ります。">
          <Card>
            <PasswordForm />
          </Card>
        </Section>
      ) : (
        // A password-changing form for an account with no password would ask
        // for a "current password" that verifies against nothing — every
        // attempt fails with a message that explains nothing, since the
        // account really has no password to get right.
        <Section title="パスワード">
          <Card>
            <p className="text-sm text-text-muted">
              Googleアカウントでログインしています。パスワードは設定されていません。
            </p>
          </Card>
        </Section>
      )}

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
