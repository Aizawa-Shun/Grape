"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

interface Props {
  productId: string;
  keyEventName: string | null;
}

/**
 * Until the owner names the one action that counts as "used it" — signup,
 * project_created, whatever this product's is — two of the five stages have
 * nothing to measure and read as zero. That is a setup gap, not a growth
 * problem, so it says so in those words rather than reporting an empty funnel.
 */
export function KeyEventForm({ productId, keyEventName }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(keyEventName ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyEventName: value.trim() || null }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "保存できませんでした。");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        {keyEventName ? (
          <span className="text-text-muted">
            ゴールの操作:{" "}
            <code className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-text">
              {keyEventName}
            </code>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="attention">未設定</Badge>
            <span className="text-text-muted">
              ゴールの操作を決めるまで「使ってもらう」と「また来てもらう」は数えられません
            </span>
          </span>
        )}
        <Button size="sm" onClick={() => setEditing(true)}>
          {keyEventName ? "変更する" : "決める"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Field
        label="ゴールの操作"
        hint={
          <>
            「ここまで来たら使ってもらえた」と言える操作に、名前を1つ付けます。サイトに貼ったコードの{" "}
            <code className="font-mono">grape(&apos;track&apos;, &apos;{value.trim() || "signup"}&apos;)</code>{" "}
            と同じ名前にしてください。
          </>
        }
      >
        {(props) => (
          <input
            {...props}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="signup"
            className={controlClass}
          />
        )}
      </Field>

      {error && <Status tone="error">{error}</Status>}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" onClick={save} loading={pending}>
          {pending ? "保存中…" : "保存する"}
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            setValue(keyEventName ?? "");
            setEditing(false);
            setError(null);
          }}
        >
          やめる
        </Button>
      </div>
    </div>
  );
}
