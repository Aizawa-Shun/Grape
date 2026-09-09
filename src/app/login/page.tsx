import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { accountsExist } from "@/core/auth/users";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  // A freshly deployed Grape has nobody to log in as. Showing a form that
  // cannot succeed, with no way to reach the one page that can, is how a
  // first-run instance becomes unusable.
  if (!(await accountsExist())) redirect("/register");

  const { next } = await searchParams;
  // Only same-site paths, so a crafted ?next= cannot bounce someone elsewhere
  // after they authenticate.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Grape</h1>
        <p className="text-sm text-text-muted">メールアドレスとパスワードでログインしてください。</p>
      </header>

      <Card>
        <LoginForm next={destination} />
      </Card>
    </main>
  );
}
