"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

/**
 * Submitting only creates the row; reading the site happens afterwards, on the
 * server, whether or not this page is still open (see api/products/route.ts).
 * So this form does not wait for any of that — it hands over to the review
 * screen as soon as there is one, which shows the progress (surviving a
 * reload) and then the AI's draft for the reader to confirm or correct.
 *
 * A text field rather than type="url": the browser's own check rejects
 * "example.com", which is how most people type an address. The server fills
 * in https:// (see normalizeProductUrl).
 */
export function RegisterProductForm() {
  const router = useRouter();
  const hintId = useId();
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
      router.push(`/products/${body.productId}/review`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          inputMode="url"
          autoComplete="url"
          required
          aria-label="サービスのURL"
          aria-describedby={hintId}
          placeholder="https://your-product.com"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={pending}
          className={controlClass}
        />
        <Button type="submit" variant="primary" loading={pending} className="sm:shrink-0">
          {pending ? "追加しています…" : "追加する"}
        </Button>
      </div>

      <p id={hintId} className="text-xs text-text-muted">
        https:// が無い場合は自動で補います。
      </p>

      {error && <Status tone="error">{error}</Status>}
    </form>
  );
}
