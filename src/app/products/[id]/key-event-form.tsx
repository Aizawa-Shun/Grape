"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  productId: string;
  keyEventName: string | null;
}

/**
 * The Activate stage of the funnel (core/data/funnel.ts) has nothing to
 * measure until the product owner names the one event that counts as
 * activation — "signup", "project_created", whatever it is for this product.
 * Until this is set, Activate and Retain both read as zero, which is a
 * config gap, not a growth problem, so it needs to be obvious and easy to fix
 * from here rather than buried in .env.
 */
export function KeyEventForm({ productId, keyEventName }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(keyEventName ?? "");
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyEventName: value.trim() || null }),
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

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        {keyEventName ? (
          <span>
            キーイベント: <code className="rounded bg-zinc-100 px-1.5 py-0.5 dark:bg-zinc-800">{keyEventName}</code>
          </span>
        ) : (
          <span className="text-amber-700 dark:text-amber-500">
            キーイベント未設定 — Activate / Retain を計測できません
          </span>
        )}
        <button
          onClick={() => setEditing(true)}
          className="shrink-0 rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700"
        >
          {keyEventName ? "変更" : "設定する"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="signup"
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          onClick={handleSave}
          disabled={status === "saving"}
          className="shrink-0 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {status === "saving" ? "保存中…" : "保存"}
        </button>
        <button
          onClick={() => {
            setValue(keyEventName ?? "");
            setEditing(false);
            setStatus("idle");
          }}
          disabled={status === "saving"}
          className="shrink-0 rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
        >
          キャンセル
        </button>
      </div>
      <p className="text-xs text-zinc-400">
        スニペットの <code>grape(&apos;track&apos;, &apos;{value.trim() || "signup"}&apos;)</code> と一致させてください。
      </p>
      {status === "error" && error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
