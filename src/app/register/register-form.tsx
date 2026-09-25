"use client";

import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { clientAuth, describeFirebaseError, establishSession } from "@/components/auth/firebase-client";
import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import { MIN_PASSWORD_LENGTH } from "@/core/auth/policy";
import type { ClientAuthSettings } from "@/server/auth/firebase-web";

/**
 * Creates the Firebase account, then asks Grape to let it in. If Grape
 * refuses — no invite, or one that has been used — the session endpoint
 * deletes the account it just created, so nothing is left behind.
 */
export function RegisterForm({
  first,
  code,
  settings,
}: {
  first: boolean;
  code: string;
  settings: ClientAuthSettings;
}) {
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
      const auth = clientAuth(settings);
      try {
        const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
        await updateProfile(user, { displayName: displayName.trim() });
        const failure = await establishSession(auth, user, first ? undefined : inviteCode.trim());
        if (failure) {
          setError(failure);
          return;
        }
        router.replace("/");
        router.refresh();
      } catch (caught) {
        setError(describeFirebaseError(caught));
      }
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

      <Field label="パスワード" hint={`${MIN_PASSWORD_LENGTH}文字以上。`}>
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
        <Field label="招待コード" hint="招待リンクから開いた場合は入力済みです。">
          {(props) => (
            <input
              {...props}
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
