"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Status } from "@/components/ui/status";
import type { InviteState, InviteSummary } from "@/core/auth/users";

/** Dates cross the server/client boundary as strings. */
type Row = Omit<InviteSummary, "createdAt" | "expiresAt" | "usedAt"> & {
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
};

const STATE_UI: Record<InviteState, { label: string; tone: "neutral" | "attention" }> = {
  open: { label: "使われていません", tone: "attention" },
  used: { label: "使われました", tone: "neutral" },
  expired: { label: "期限切れ", tone: "neutral" },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function InviteIssuer({ initial, origin }: { initial: Row[]; origin: string }) {
  const [rows, setRows] = useState(initial);
  const [issued, setIssued] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const link = issued ? `${origin}/register?invite=${issued.code}` : "";

  function issue() {
    setError(null);
    setCopied(false);

    startTransition(async () => {
      const response = await fetch("/api/auth/invites", { method: "POST" });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "発行できませんでした。");
        return;
      }
      setIssued({ code: body.code, expiresAt: body.expiresAt });

      const listed = await fetch("/api/auth/invites").then((r) => r.json()).catch(() => null);
      if (listed?.invites) setRows(listed.invites);
    });
  }

  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <Button variant="primary" loading={pending} onClick={issue}>
            {pending ? "発行中…" : "招待リンクを発行する"}
          </Button>
        </div>
        {error && <Status tone="error">{error}</Status>}
      </div>

      {issued && (
        <Callout tone="attention">
          <p className="font-medium">このリンクは、いま一度だけ表示されます。</p>
          <p className="mt-1">
            Grapeはメールを送れないので、渡すのはあなたの仕事です。控えを残さず閉じると、もう一度発行し直すことになります。
          </p>
          <p className="mt-2 break-all rounded-sm bg-surface px-2 py-1.5 font-mono text-xs">
            {link}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={copy}>{copied ? "コピーしました" : "リンクをコピー"}</Button>
            <span className="text-xs text-text-muted">
              {formatDate(issued.expiresAt)}まで有効
            </span>
          </div>
        </Callout>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="まだ誰も招待していません"
          body="発行したリンクはここに並びます。使われたかどうかも分かります。"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <Card as="li" key={row.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">{formatDate(row.createdAt)}に発行</span>
                <Badge tone={STATE_UI[row.state].tone}>{STATE_UI[row.state].label}</Badge>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {row.state === "used" && row.usedAt
                  ? `${formatDate(row.usedAt)}に使われました`
                  : `${formatDate(row.expiresAt)}まで有効`}
              </p>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
