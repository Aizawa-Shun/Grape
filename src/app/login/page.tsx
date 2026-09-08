import { Card } from "@/components/ui/card";

import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Only same-site paths, so a crafted ?next= cannot bounce someone elsewhere
  // after they authenticate.
  const destination = next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-16">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Grape</h1>
        <p className="text-sm text-text-muted">
          このGrapeは公開URLからも開けるため、パスワードで保護されています。
        </p>
      </header>

      <Card>
        <LoginForm next={destination} />
      </Card>
    </main>
  );
}
