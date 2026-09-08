"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    // The fetch and the navigation share one transition, so the button stays
    // busy until the next page is actually on screen.
    startTransition(async () => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "ログインできませんでした。");
        return;
      }
      router.replace(next);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="パスワード" hint=".env の GRAPE_ADMIN_PASSWORD に設定した値です。">
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={controlClass}
          />
        )}
      </Field>

      {error && <Status tone="error">{error}</Status>}

      <Button type="submit" variant="primary" loading={pending} disabled={password.length === 0}>
        {pending ? "確認中…" : "開く"}
      </Button>
    </form>
  );
}
