"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Registration is synchronous (crawl + extraction can take from a few seconds
 * on the API to a couple of minutes on a local model — see .env.example), so
 * this form has to hold its own loading state rather than relying on a page
 * transition to show progress.
 */
export function RegisterProductForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("loading");
    setError(null);

    try {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);

      router.push(`/products/${body.productId}`);
      router.refresh();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          type="url"
          required
          placeholder="https://your-product.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={status === "loading"}
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
        >
          {status === "loading" ? "解析中…" : "登録"}
        </button>
      </div>
      {status === "loading" && (
        <p className="text-sm text-zinc-500">
          サイトをクロールし、Product Contextを抽出しています。ローカルモデルの場合は数分かかることがあります。
        </p>
      )}
      {status === "error" && error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
