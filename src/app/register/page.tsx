import { FirebaseNotConfigured } from "@/components/auth/firebase-not-configured";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { GrapeMark } from "@/components/ui/grape-mark";
import { TextLink } from "@/components/ui/text-link";
import { accountsExist } from "@/core/auth/users";
import { clientAuthSettings } from "@/server/auth/firebase-web";

import { LoginForm } from "../login/login-form";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

/**
 * Open exactly once, then only to people holding a code.
 *
 * The page does not say whether a code is valid — that answer belongs to the
 * submission, which is rate limited. Showing "this code is unknown" before
 * anyone has typed a password would turn this into a place to test guesses.
 */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  const first = !(await accountsExist());
  const settings = clientAuthSettings();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-16">
      <header className="flex flex-col gap-1">
        <GrapeMark size={40} className="mb-2" />
        <h1 className="text-2xl font-semibold tracking-tight">Grape</h1>
        <p className="text-sm text-text-muted">
          {first
            ? "最初のアカウントを作ります。この人がオーナーになり、以降の登録は招待制になります。"
            : "招待を受けた方のアカウントを作ります。"}
        </p>
      </header>

      {!settings ? (
        <FirebaseNotConfigured />
      ) : !first && !invite ? (
        <Callout tone="attention">
          このGrapeはすでに使われているので、登録には招待が必要です。オーナーに招待リンクを発行してもらってください。
        </Callout>
      ) : (
        <Card>
          <div className="flex flex-col gap-4">
            <RegisterForm first={first} code={invite ?? ""} settings={settings} />
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <div className="h-px flex-1 bg-border" />
              または
              <div className="h-px flex-1 bg-border" />
            </div>
            {/* The invite travels with a Google sign-up exactly as with the form above. */}
            <LoginForm next="/" settings={settings} inviteCode={invite} showPassword={false} />
          </div>
        </Card>
      )}

      <p className="text-sm text-text-muted">
        すでにアカウントをお持ちですか？ <TextLink href="/login">ログイン</TextLink>
      </p>
    </main>
  );
}
