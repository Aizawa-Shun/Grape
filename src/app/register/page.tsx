import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { GrapeMark } from "@/components/ui/grape-mark";
import { TextLink } from "@/components/ui/text-link";
import { accountsExist } from "@/core/auth/users";

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

      {!first && !invite ? (
        <Callout tone="attention">
          このGrapeはすでに使われているので、登録には招待が必要です。オーナーに招待リンクを発行してもらってください。
        </Callout>
      ) : (
        <Card>
          <RegisterForm first={first} code={invite ?? ""} />
        </Card>
      )}

      {/*
        Offered unconditionally, including on a fresh instance. It was left off
        there while /login redirected back to this page whenever nobody had
        registered, which made the link a loop; /login now answers for itself
        instead, so the choice is a real one in both directions.

        On a fresh instance it leads to a page saying there is nobody to sign
        in as yet — which is the honest answer to "can I log in instead?", and
        a better one than an option that is simply missing.
      */}
      <p className="text-sm text-text-muted">
        すでにアカウントをお持ちですか？ <TextLink href="/login">ログイン</TextLink>
      </p>
    </main>
  );
}
