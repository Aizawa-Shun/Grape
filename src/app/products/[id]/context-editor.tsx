"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ContextEditInput } from "@/core/context/edit";

interface Props {
  productId: string;
  initial: ContextEditInput;
  gaps: string[];
  editedByHuman: boolean;
}

const FIELDS: { key: keyof ContextEditInput; label: string; hint: string }[] = [
  { key: "what", label: "What — 何をするものか", hint: "" },
  { key: "who", label: "Who — 誰のためのものか", hint: "" },
  { key: "why", label: "Why — どんな課題を解くのか", hint: "" },
  { key: "how", label: "How — どう動くのか", hint: "" },
];

/**
 * A wrong Product Context poisons every diagnosis and generated artifact built
 * on top of it (see extract.ts), so this editor is not a nice-to-have — it is
 * the only way to recover from an extraction mistake. Saving always creates a
 * new version rather than mutating the current one (see edit.ts).
 */
export function ContextEditor({ productId, initial, gaps, editedByHuman }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<ContextEditInput>(initial);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const dirty = FIELDS.some((field) => values[field.key] !== initial[field.key]);

  async function handleSave() {
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch(`/api/products/${productId}/context`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setEditing(false);
      setStatus("idle");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {!editedByHuman && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          このContextはサイトからの自動抽出のみで、まだ人間が確認していません。内容が違っていたら下から修正してください。
        </p>
      )}

      {gaps.length > 0 && (
        <div className="rounded-md border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
          <p className="font-medium text-zinc-600 dark:text-zinc-400">サイト上に記載が無かった項目</p>
          <ul className="mt-1 list-inside list-disc text-zinc-500">
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {FIELDS.map((field) => (
          <div key={field.key} className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400">{field.label}</label>
            {editing ? (
              <textarea
                value={values[field.key]}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                rows={3}
                className="rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm">{values[field.key]}</p>
            )}
          </div>
        ))}
      </div>

      {status === "error" && error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        {editing ? (
          <>
            <button
              onClick={handleSave}
              disabled={!dirty || status === "saving"}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
            >
              {status === "saving" ? "保存中…" : "新しいバージョンとして保存"}
            </button>
            <button
              onClick={() => {
                setValues(initial);
                setEditing(false);
              }}
              disabled={status === "saving"}
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
            >
              キャンセル
            </button>
          </>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700"
          >
            修正する
          </button>
        )}
      </div>
    </div>
  );
}
