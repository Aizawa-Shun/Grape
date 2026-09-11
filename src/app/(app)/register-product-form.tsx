"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

/**
 * Submitting only creates the row; reading the site happens afterwards, on the
 * server, whether or not this page is still open (see api/products/route.ts).
 * So this form no longer waits for any of that — it hands over to the product
 * page as soon as there is a product page to hand over to, and the progress
 * that used to live here lives there instead, where it survives a reload.
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
          {pending ? "追加しています…" : "追加する"}
        </Button>
      </div>

      {error && <Status tone="error">{error}</Status>}
    </form>
  );
}
