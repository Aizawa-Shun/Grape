"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";

/**
 * The one setting on this page that does not live in SettingsForm's batched
 * save. Everything else there commits every dirty field in a single PATCH
 * when you click 保存する — fine for a timeout or a log level, wrong for the
 * flag that stands between a draft and a real, billed, irreversible post to
 * X. This writes GRAPE_ACTION_DRY_RUN by itself, immediately, and asks a
 * separate window.confirm before it will turn sending on — see the "what is
 * *not* here" comment in core/settings/index.ts.
 *
 * window.confirm rather than a custom dialog, same reasoning as
 * DeleteProductButton: this is a one-click-away action with no other review
 * step in front of it.
 */
export function DryRunToggle({
  dryRun,
  /** What .env alone gives — lets a flip back to that value clear the override row instead of pinning a redundant one. */
  envDryRun,
  wasOverridden,
}: {
  dryRun: boolean;
  envDryRun: boolean;
  wasOverridden: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function set(next: boolean) {
    if (!next) {
      const confirmed = window.confirm(
        "練習モードをオフにします。これ以降、承認した投稿は本当にXへ送信され、取り消せません。よろしいですか？",
      );
      if (!confirmed) return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // Matches the convention in settings-form.tsx: a value equal to the
        // .env default is sent as "" so the override row is removed rather
        // than kept as a copy that silently stops tracking the file.
        body: JSON.stringify({ GRAPE_ACTION_DRY_RUN: next === envDryRun ? "" : String(next) }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "変更できませんでした。");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <dt>
          練習モード
          <span className="block text-xs text-text-muted">
            投稿は取り消せず費用もかかります。オフにする前に確認が出ます。
          </span>
        </dt>
        <dd className="flex shrink-0 items-center gap-2">
          {wasOverridden && <Badge tone="attention">ここで変更中</Badge>}
          <span className="font-medium">
            {dryRun ? "オン（送りません）" : "オフ（本当に送ります）"}
          </span>
          <Button
            size="sm"
            variant={dryRun ? "danger" : "secondary"}
            onClick={() => set(!dryRun)}
            loading={pending}
          >
            {dryRun ? "オフにする" : "オンに戻す"}
          </Button>
        </dd>
      </div>
      {error && <Status tone="error">{error}</Status>}
    </div>
  );
}
