"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import type { ContextEditInput } from "@/core/context/edit";

interface Props {
  productId: string;
  initial: ContextEditInput;
  gaps: string[];
  editedByHuman: boolean;
}

/**
 * Everything downstream — which stage is blamed, what this week's tasks are,
 * what any generated post says — is reasoned from these four answers. If they
 * are wrong, all of it is wrong in a way that looks confident, so this is the
 * one screen that has to invite correction rather than just display a result.
 *
 * The labels drop the What/Who/Why/How framing: the reader does not need to
 * learn a framework to answer "誰のためのものか".
 */
const FIELDS: { key: keyof ContextEditInput; label: string; hint: string }[] = [
  { key: "what", label: "何をするものか", hint: "ひとことで言うと、これは何ですか。" },
  { key: "who", label: "誰のためのものか", hint: "どんな人に使ってほしいですか。" },
  { key: "why", label: "何の役に立つのか", hint: "その人のどんな困りごとが解決しますか。" },
  { key: "how", label: "どうやって使うのか", hint: "使う人は何をすることになりますか。" },
];

export function ContextEditor({ productId, initial, gaps, editedByHuman }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<ContextEditInput>(initial);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = FIELDS.some((field) => values[field.key] !== initial[field.key]);

  function save() {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/products/${productId}/context`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
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

  return (
    <div className="flex flex-col gap-5">
      {!editedByHuman && (
        <Callout tone="attention">
          これはサイトを読んで自動で書いたもので、まだあなたの確認を受けていません。
          この内容をもとに診断も提案も作られるので、違っていたら直してください。
        </Callout>
      )}

      {gaps.length > 0 && (
        <Callout title="サイトに書かれていなかったこと">
          <ul className="list-inside list-disc">
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="flex flex-col gap-4">
        {FIELDS.map((field) =>
          editing ? (
            <Field key={field.key} label={field.label} hint={field.hint}>
              {(props) => (
                <textarea
                  {...props}
                  value={values[field.key]}
                  onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                  rows={3}
                  className={controlClass}
                />
              )}
            </Field>
          ) : (
            <div key={field.key} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-text-muted">{field.label}</h3>
              <p className="whitespace-pre-wrap text-sm">{values[field.key]}</p>
            </div>
          ),
        )}
      </div>

      {error && <Status tone="error">{error}</Status>}

      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button variant="primary" onClick={save} loading={pending} disabled={!dirty}>
              {pending ? "保存中…" : "保存する"}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                setValues(initial);
                setEditing(false);
                setError(null);
              }}
            >
              やめる
            </Button>
          </>
        ) : (
          <Button onClick={() => setEditing(true)}>書き直す</Button>
        )}
      </div>
    </div>
  );
}
