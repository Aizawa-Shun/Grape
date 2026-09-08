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

      {editing ? (
        <div className="flex flex-col gap-4">
          {FIELDS.map((field) => (
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
          ))}
        </div>
      ) : (
        /*
         * A spec table, not four stacked label/value pairs. It is a definition
         * list in fact as well as in markup now, and pairing each label with
         * its answer on one row turned roughly 200px of loose vertical stack
         * into something that can be checked at a glance — which is the whole
         * job of this screen.
         */
        <dl className="divide-y divide-border overflow-hidden rounded-md border border-border shadow-card">
          {FIELDS.map((field) => (
            <div
              key={field.key}
              className="grid gap-0.5 px-4 py-3 sm:grid-cols-[9.5rem_1fr] sm:gap-4"
            >
              <dt className="text-sm text-text-muted">{field.label}</dt>
              <dd className="whitespace-pre-wrap text-sm">{values[field.key]}</dd>
            </div>
          ))}
        </dl>
      )}

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
