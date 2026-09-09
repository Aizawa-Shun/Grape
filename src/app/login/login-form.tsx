"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ email, password }),
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
      <Field label="メールアドレス">
        {(props) => (
          <input
            {...props}
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={controlClass}
          />
        )}
      </Field>

      <Field label="パスワード">
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={controlClass}
          />
        )}
      </Field>

      {error && <Status tone="error">{error}</Status>}

      <Button
        type="submit"
        variant="primary"
        loading={pending}
        disabled={email.length === 0 || password.length === 0}
      >
        {pending ? "確認中…" : "ログイン"}
      </Button>
    </form>
  );
}
