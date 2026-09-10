"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import { MIN_PASSWORD_LENGTH } from "@/core/auth/policy";

interface Props {
  displayName: string;
  email: string;
}

/**
 * Two forms rather than one, and two cards rather than one, because they
 * answer to different rules: the profile saves on the session alone, and the
 * password asks for the old one. Merged, a single save button would have had
 * to demand the current password to change a display name — and run together
 * under one border, the second form's first field reads as a third field of
 * the first.
 */
export function ProfileForm({ displayName: initialName, email: initialEmail }: Props) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const changed = displayName !== initialName || email !== initialEmail;
  const ready = changed && displayName.trim().length > 0 && email.trim().length > 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName, email }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "保存できませんでした。");
        return;
      }
      setSaved(true);
      // The account menu at the bottom of every page shows both of these, so
      // leaving the shell on the old values would look like the save missed.
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
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved(false);
            }}
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
            onChange={(e) => {
              setEmail(e.target.value);
              setSaved(false);
            }}
            className={controlClass}
          />
        )}
      </Field>

      {error && <Status tone="error">{error}</Status>}
      {saved && <Status>保存しました。</Status>}

      <div>
        <Button type="submit" variant="primary" loading={pending} disabled={!ready}>
          {pending ? "保存中…" : "保存する"}
        </Button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  const ready = currentPassword.length > 0 && newPassword.length >= MIN_PASSWORD_LENGTH;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDone(false);

    startTransition(async () => {
      const response = await fetch("/api/account/password", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "変更できませんでした。");
        return;
      }
      setDone(true);
      setCurrentPassword("");
      setNewPassword("");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <Field label="いまのパスワード">
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setDone(false);
            }}
            className={controlClass}
          />
        )}
      </Field>

      <Field
        label="新しいパスワード"
        hint={`${MIN_PASSWORD_LENGTH}文字以上。記号の混在より長さのほうが効きます。`}
      >
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setDone(false);
            }}
            className={controlClass}
          />
        )}
      </Field>

      {error && <Status tone="error">{error}</Status>}
      {done && <Status>パスワードを変更しました。</Status>}

      <div>
        <Button type="submit" variant="primary" loading={pending} disabled={!ready}>
          {pending ? "変更中…" : "パスワードを変える"}
        </Button>
      </div>
    </form>
  );
}
