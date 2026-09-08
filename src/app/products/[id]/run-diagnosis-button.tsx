"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  productId: string;
}

/**
 * The one action on this page that costs an LLM call at "high" effort (see
 * EFFORT_BY_KIND) — seconds on Anthropic, potentially minutes on a CPU-only
 * local model — so it is a deliberate button press, not something that runs
 * on every page load. See POST /api/products/[id]/diagnose.
 */
export function RunDiagnosisButton({ productId }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setStatus("running");
    setError(null);
    try {
      const response = await fetch(`/api/products/${productId}/diagnose`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setStatus("idle");
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={status === "running"}
        className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {status === "running" ? "診断中…（ローカルモデルの場合は数分かかることがあります）" : "今週の診断を実行"}
      </button>
      {status === "error" && error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
