"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";

/**
 * Starts reading the site again (POST /api/products/[id]/reread) and hands
 * over to whatever page this is on: the row is pending by the time the
 * response arrives, so a refresh is enough for that page to show progress.
 */
export function RereadButton({
  productId,
  label = "サイトを読み直す",
}: {
  productId: string;
  label?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function start() {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/products/${productId}/reread`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "読み直しを始められませんでした。もう一度お試しください。");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button size="sm" onClick={start} loading={pending}>
          {pending ? "始めています…" : label}
        </Button>
      </div>
      {error && <Status tone="error">{error}</Status>}
    </div>
  );
}
