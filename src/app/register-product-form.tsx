"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

/**
 * Registration is synchronous — reading the site and working out what it is
 * takes seconds on the API and can take minutes on a local model — so this
 * form has to show its own progress rather than relying on a page transition.
 */
export function RegisterProductForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "登録できませんでした。もう一度お試しください。");
        return;
      }
      router.push(`/products/${body.productId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          required
          aria-label="サービスのURL"
          placeholder="https://your-product.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={pending}
          className={controlClass}
        />
        <Button type="submit" variant="primary" loading={pending} className="sm:shrink-0">
          {pending ? "読み込み中…" : "追加する"}
        </Button>
      </div>

      {pending && (
        <Status>
          サイトを読んで、何のサービスかを整理しています。手元のモデルを使っている場合は数分かかることがあります。
        </Status>
      )}
      {error && <Status tone="error">{error}</Status>}
    </form>
  );
}
