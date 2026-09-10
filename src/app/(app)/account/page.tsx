import { Card } from "@/components/ui/card";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { requireUser } from "@/server/auth/current-user";

import { PasswordForm, ProfileForm } from "./account-form";

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

  return (
    <Page>
      <PageHeader
        title="アカウント"
        description="ログインに使う情報です。このGrapeの中だけで完結していて、どこにも送られません。"
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

      <Section
        title="パスワード"
        description="変えるには、いま使っているパスワードが要ります。"
      >
        <Card>
          <PasswordForm />
        </Card>
      </Section>
    </Page>
  );
}
