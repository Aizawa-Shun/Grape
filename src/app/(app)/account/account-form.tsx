"use client";

import { sendPasswordResetEmail } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { clientAuth } from "@/components/auth/firebase-client";
import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import type { ClientAuthSettings } from "@/server/auth/firebase-web";

/**
 * The display name is Grape's; the e-mail address and password are Firebase
 * Authentication's. So this form edits one field and shows the address as
 * what it is — the sign-in identity, changed through Firebase if at all.
 */
export function ProfileForm({ displayName: initialName, email }: { displayName: string; email: string }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const ready = displayName !== initialName && displayName.trim().length > 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    startTransition(async () => {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "保存できませんでした。");
        return;
      }
      setSaved(true);
      // The account menu at the bottom of every page shows the name, so
      // leaving the shell on the old value would look like the save missed.
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

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">メールアドレス</span>
        <span className="text-sm text-text-muted">{email}</span>
        <span className="text-xs text-text-muted">ログインに使うアドレスです。</span>
      </div>

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

/**
 * Changing a password is Firebase's reset flow: an e-mail with a link to a
 * page where the new one is set. Grape never sees either password, and the
 * link proves control of the address — which is what asking for the current
 * password used to stand in for.
 */
export function PasswordResetForm({ email, settings }: { email: string; settings: ClientAuthSettings }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    setError(null);
    startTransition(async () => {
      try {
        await sendPasswordResetEmail(clientAuth(settings), email);
        setSent(true);
      } catch {
        setError("送れませんでした。しばらくしてから、もう一度お試しください。");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">
        {email} にパスワード再設定の案内を送ります。メールのリンクから新しいパスワードを決めてください。
      </p>
      {error && <Status tone="error">{error}</Status>}
      {sent && <Status>送りました。メールを確認してください。</Status>}
      <div>
        <Button onClick={send} loading={pending} disabled={sent}>
          {pending ? "送っています…" : "再設定のメールを送る"}
        </Button>
      </div>
    </div>
  );
}
