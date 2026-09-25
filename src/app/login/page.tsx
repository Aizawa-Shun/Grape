import { FirebaseNotConfigured } from "@/components/auth/firebase-not-configured";
import { Card } from "@/components/ui/card";
import { GrapeMark } from "@/components/ui/grape-mark";
import { TextLink } from "@/components/ui/text-link";
import { accountsExist } from "@/core/auth/users";
import { clientAuthSettings } from "@/server/auth/firebase-web";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const settings = clientAuthSettings();
  const first = !(await accountsExist());

  const { next } = await searchParams;
  // Only same-site paths, so a crafted ?next= cannot bounce someone elsewhere
  // after they authenticate.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-16">
      <header className="flex flex-col gap-1">
        <GrapeMark size={40} className="mb-2" />
        <h1 className="text-2xl font-semibold tracking-tight">Grape</h1>
        <p className="text-sm text-text-muted">
          {first
            ? "このGrapeにはまだアカウントがありません。最初にログインした人がオーナーになり、以降の登録は招待制になります。"
            : "メールアドレスとパスワード、またはGoogleアカウントでログインしてください。"}
        </p>
      </header>

      {settings ? (
        <Card>
          <LoginForm next={destination} settings={settings} />
        </Card>
      ) : (
        <FirebaseNotConfigured />
      )}

      <p className="text-sm text-text-muted">
        {first ? "メールアドレスで始めるなら " : "招待を受けましたか？ "}
        <TextLink href="/register">アカウントを作る</TextLink>
      </p>
    </main>
  );
}
