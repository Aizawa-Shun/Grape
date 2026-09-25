"use client";

import { GoogleAuthProvider, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { clientAuth, describeFirebaseError, establishSession } from "@/components/auth/firebase-client";
import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import type { ClientAuthSettings } from "@/server/auth/firebase-web";

/**
 * Sign-in through Firebase Authentication — e-mail and password, or Google —
 * then one call to Grape to turn that into a session (establishSession).
 * The password never reaches Grape's server at all.
 */
export function LoginForm({
  next,
  settings,
  inviteCode,
  showPassword = true,
}: {
  next: string;
  settings: ClientAuthSettings;
  /** Present on an invited registration, so a Google sign-up spends the invite. */
  inviteCode?: string;
  showPassword?: boolean;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(signIn: () => Promise<{ user: import("firebase/auth").User }>) {
    setError(null);
    setNotice(null);
    // The sign-in, the session call and the navigation share one transition,
    // so the button stays busy until the next page is on screen.
    startTransition(async () => {
      const auth = clientAuth(settings);
      try {
        const { user } = await signIn();
        const failure = await establishSession(auth, user, inviteCode);
        if (failure) {
          setError(failure);
          return;
        }
        router.replace(next);
        router.refresh();
      } catch (caught) {
        setError(describeFirebaseError(caught));
      }
    });
  }

  function forgotPassword() {
    setError(null);
    setNotice(null);
    if (!email.trim()) {
      setError("先にメールアドレスを入力してください。そのアドレスに再設定の案内を送ります。");
      return;
    }
    startTransition(async () => {
      try {
        await sendPasswordResetEmail(clientAuth(settings), email.trim());
      } catch {
        // Same answer whether or not the address has an account, so this
        // cannot be used to find out who is registered.
      }
      setNotice("登録されているアドレスなら、パスワード再設定の案内を送りました。メールを確認してください。");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {showPassword && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(() => signInWithEmailAndPassword(clientAuth(settings), email.trim(), password));
          }}
          className="flex flex-col gap-4"
        >
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

          <Button
            type="submit"
            variant="primary"
            loading={pending}
            disabled={email.length === 0 || password.length === 0}
          >
            {pending ? "確認中…" : "ログイン"}
          </Button>

          <button
            type="button"
            onClick={forgotPassword}
            disabled={pending}
            className="w-fit text-xs text-text-muted underline underline-offset-2 hover:text-text"
          >
            パスワードを忘れた
          </button>
        </form>
      )}

      {showPassword && (
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <div className="h-px flex-1 bg-border" />
          または
          <div className="h-px flex-1 bg-border" />
        </div>
      )}

      <Button
        type="button"
        disabled={pending}
        onClick={() => run(() => signInWithPopup(clientAuth(settings), new GoogleAuthProvider()))}
      >
        Googleでログイン
      </Button>

      {error && <Status tone="error">{error}</Status>}
      {notice && <Status>{notice}</Status>}
    </div>
  );
}
