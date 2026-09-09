"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import { MIN_PASSWORD_LENGTH } from "@/core/auth/users";

export function RegisterForm({ first, code }: { first: boolean; code: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState(code);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready =
    displayName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    (first || inviteCode.trim().length > 0);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          email,
          password,
          ...(first ? {} : { code: inviteCode.trim() }),
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "登録できませんでした。");
        return;
      }
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="表示名">
        {(props) => (
          <input
            {...props}
            autoComplete="name"
            autoFocus
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={controlClass}
          />
        )}
      </Field>

      <Field label="メールアドレス" hint="ログインに使います。">
        {(props) => (
          <input
            {...props}
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={controlClass}
          />
        )}
      </Field>

      <Field
        label="パスワード"
        hint={`${MIN_PASSWORD_LENGTH}文字以上。記号の混在より長さのほうが効きます。`}
      >
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={controlClass}
          />
        )}
      </Field>

      {!first && (
        <Field label="招待コード">
          {(props) => (
            <input
              {...props}
              autoComplete="off"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              className={controlClass}
            />
          )}
        </Field>
      )}

      {error && <Status tone="error">{error}</Status>}

      <Button type="submit" variant="primary" loading={pending} disabled={!ready}>
        {pending ? "作成中…" : "アカウントを作る"}
      </Button>
    </form>
  );
}
