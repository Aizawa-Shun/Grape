"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";

/**
 * The one way to clear a product Grape never managed to read — this used to
 * not exist, so a crawl or extraction failure left an empty row on the
 * dashboard with no way to remove it. Registration failures now undo
 * themselves (see core/product/register.ts), but this stays for the products
 * that failure predates, and for a service you simply no longer want tracked.
 *
 * window.confirm rather than a custom dialog: this is the only destructive
 * action in the app that is one click away on a page with no second step, and
 * every other confirmation Grape needs (approving a task, changing a password)
 * already reads its own current-password or review step as the confirmation.
 */
export function DeleteProductButton({ productId, name }: { productId: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    if (!window.confirm(`「${name}」を削除します。調べた内容やタスクもすべて消えます。よろしいですか？`)) {
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/products/${productId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "削除できませんでした。もう一度お試しください。");
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="danger" size="sm" onClick={start} loading={pending}>
        {pending ? "削除しています…" : "このサービスを削除"}
      </Button>
      {error && <Status tone="error">{error}</Status>}
    </div>
  );
}
