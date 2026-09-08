"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";

/**
 * The one action here that costs a model call at the highest effort tier —
 * seconds on the API, minutes on a CPU-only local model — so it is a
 * deliberate press rather than something that runs on page load.
 *
 * Because it can take minutes, the elapsed count matters: a button that only
 * says "診断中…" for two minutes is indistinguishable from one that is stuck.
 */
export function RunDiagnosisButton({ productId, label }: { productId: string; label?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  function start() {
    setError(null);
    setSeconds(0);
    // Request and refresh share one transition, so the button stays busy until
    // the new diagnosis is actually rendered — previously it reverted first,
    // leaving a window where the page looked done but had not changed.
    startTransition(async () => {
      const response = await fetch(`/api/products/${productId}/diagnose`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(body.error ?? "調べられませんでした。もう一度お試しください。");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="primary" size="sm" onClick={start} loading={pending} className="self-start">
        {pending ? `調べています… ${seconds}秒` : (label ?? "いまの状態を調べる")}
      </Button>

      {pending && (
        <Status>
          数字を集めて、どこで詰まっているかと、その理由を書いています。
          手元のモデルを使っている場合は数分かかることがあります。
        </Status>
      )}
      {error && <Status tone="error">{error}</Status>}
    </div>
  );
}
