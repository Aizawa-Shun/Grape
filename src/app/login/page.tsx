import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { GrapeMark } from "@/components/ui/grape-mark";
import { TextLink } from "@/components/ui/text-link";
import { googleSignInAvailable } from "@/core/auth/google";
import { accountsExist } from "@/core/auth/users";

import { GoogleSignInButton } from "./google-sign-in-button";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  // A freshly deployed Grape has nobody to log in as. This used to redirect
  // straight to /register, on the reasoning that a form which cannot succeed,
  // with no way to reach the one page that can, is how a first-run instance
  // becomes unusable. The second half of that stopped being true once this
  // page grew a link to registration — so the answer is now given here rather
  // than by silently moving somebody who asked for the sign-in page.
  //
  // The form is still not rendered: there is genuinely nothing to sign in as,
  // and offering the fields anyway would only produce a failure that explains
  // nothing.
  const canSignIn = await accountsExist();
  const showGoogle = googleSignInAvailable();

  const { next, error } = await searchParams;
  // Only same-site paths, so a crafted ?next= cannot bounce someone elsewhere
  // after they authenticate.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-16">
      <header className="flex flex-col gap-1">
        <GrapeMark size={40} className="mb-2" />
        <h1 className="text-2xl font-semibold tracking-tight">Grape</h1>
        <p className="text-sm text-text-muted">
          {canSignIn
            ? "メールアドレスとパスワードでログインしてください。"
            : "このGrapeにはまだアカウントがありません。"}
        </p>
      </header>

      {/* Google's own redirect back here on a failed attempt — a cancelled
          consent screen, a state mismatch, an account with no verified
          e-mail — carries the reason as ?error=, since the callback route has
          no page of its own to show it on. */}
      {error && <Callout tone="attention">{error}</Callout>}

      {canSignIn ? (
        <Card>
          <div className="flex flex-col gap-4">
            <LoginForm next={destination} />
            {showGoogle && (
              <>
                <div className="flex items-center gap-3 text-xs text-text-muted">
                  <div className="h-px flex-1 bg-border" />
                  または
                  <div className="h-px flex-1 bg-border" />
                </div>
                <GoogleSignInButton next={destination} />
              </>
            )}
          </div>
        </Card>
      ) : showGoogle ? (
        <Card>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">
              最初のアカウントを作るところから始まります。作った人がオーナーになり、以降の登録は招待制になります。
            </p>
            <GoogleSignInButton next={destination} label="Googleで始める" />
          </div>
        </Card>
      ) : (
        <Callout tone="attention">
          最初のアカウントを作るところから始まります。作った人がオーナーになり、以降の登録は招待制になります。
        </Callout>
      )}

      {/*
        Once an account exists, registration is invitation-only, so this leads
        to a page that will usually explain that rather than to a form. That is
        still the answer to the question the reader has — the alternative was a
        page offering one thing to do and no way to ask about anything else.
      */}
      <p className="text-sm text-text-muted">
        {canSignIn ? "招待コードをお持ちですか？ " : ""}
        <TextLink href="/register">アカウントを作る</TextLink>
      </p>
    </main>
  );
}
