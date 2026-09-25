"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import { xWeightedLength, X_WEIGHTED_LIMIT } from "@/core/action/channels/x-text";
import type { Post, PostMetrics } from "@/db/schema";

import { POST_TYPE_LABELS } from "./labels";
import { send } from "./request";

export interface PostCardProps {
  post: Post;
  /** Whether this goes out through X (a post, or a reply to an X conversation). */
  viaX: boolean;
  dryRun: boolean;
  /** X posting credentials exist on this instance. */
  xConfigured: boolean;
  /** Visits and signups the tracking snippet traced back to this post. */
  attribution: { visits: number; signups: number } | null;
}

function intentUrl(text: string, inReplyTo: string | null): string {
  const url = new URL("https://x.com/intent/post");
  url.searchParams.set("text", text);
  if (inReplyTo) url.searchParams.set("in_reply_to", inReplyTo);
  return url.toString();
}

const METRIC_FIELDS: { key: keyof Omit<PostMetrics, "source">; label: string }[] = [
  { key: "impressions", label: "表示" },
  { key: "likes", label: "いいね" },
  { key: "replies", label: "返信" },
  { key: "reposts", label: "リポスト" },
  { key: "bookmarks", label: "ブックマーク" },
  { key: "profileVisits", label: "プロフィール訪問" },
  { key: "linkClicks", label: "リンククリック" },
];

/**
 * One post or reply, from draft to result — the approval step of the loop
 * (spec §18). Nothing is sent without this card's button, unless the owner
 * has explicitly chosen the autonomous mode; and practice mode stops even
 * that. Every draft says why it was written.
 */
export function PostCard({ post, viaX, dryRun, xConfigured, attribution }: PostCardProps) {
  const router = useRouter();
  const [text, setText] = useState(post.text);
  const [reason, setReason] = useState("");
  const [postedUrl, setPostedUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const weight = xWeightedLength(text);
  const over = viaX && weight > X_WEIGHTED_LIMIT;
  const editable = post.status === "draft" || post.status === "failed" || (post.status === "approved" && post.dryRun);
  const hasLink = /https?:\/\//.test(text);

  function act(name: string, path: string, method: "POST" | "PUT", body?: unknown) {
    setBusy(name);
    setError(null);
    startTransition(async () => {
      const result = await send(path, method, body);
      setBusy(null);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  const approveLabel = !viaX
    ? "承認する"
    : dryRun
      ? "承認する（練習モード・送信されません）"
      : post.kind === "reply"
        ? "承認してXに返信する"
        : "承認してXに投稿する";

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{post.kind === "reply" ? "返信" : "投稿"}</Badge>
        {post.kind === "post" && <span className="text-xs text-text-muted">{POST_TYPE_LABELS[post.postType]}{post.pillar ? ` ・ ${post.pillar}` : ""}</span>}
        {post.plannedFor && <span className="text-xs text-text-subtle">予定 {post.plannedFor}</span>}
        <span className="ml-auto">
          <StatusBadge post={post} />
        </span>
      </div>

      {post.kind === "reply" && post.replyToUrl && (
        <a href={post.replyToUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-text-muted underline-offset-2 hover:underline">
          返信先の投稿を開く
        </a>
      )}

      {editable ? (
        <div className="flex flex-col gap-1">
          <textarea
            aria-label="本文"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(10, Math.max(4, text.split("\n").length + 1))}
            className={controlClass}
          />
          {viaX && (
            <p className={over ? "text-xs text-negative" : "text-xs text-text-subtle"}>
              {weight} / {X_WEIGHTED_LIMIT}（Xの数え方。全角は2、URLは23）
              {hasLink ? " ・ リンク付きの投稿はXの利用料が高くなります（約$0.20）" : " ・ 約$0.015"}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm whitespace-pre-line">{post.text}</p>
      )}

      <p className="text-xs text-text-muted">
        <span className="font-medium">なぜこの案か: </span>
        {post.rationale}
      </p>

      {post.status === "failed" && post.error && <Status tone="error">前回は送信できませんでした: {post.error}</Status>}
      {post.status === "rejected" && post.error && <p className="text-xs text-text-subtle">見送った理由: {post.error}</p>}

      {editable && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          {post.status === "approved" && post.dryRun && (
            <p className="text-xs text-attention">練習モードで承認済みです。実際には送信されていません。練習モードをオフにすると、ここから本当に送信できます。</p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={over} loading={pending && busy === "approve"} onClick={() => act("approve", `/api/growth/posts/${post.id}/approve`, "POST", { text })}>
              {approveLabel}
            </Button>
            <input
              aria-label="見送る理由（任意）"
              placeholder="見送る理由（任意・次の案に活かします）"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={`${controlClass} max-w-64 py-1.5 text-xs`}
            />
            <Button size="sm" variant="ghost" loading={pending && busy === "reject"} onClick={() => act("reject", `/api/growth/posts/${post.id}/reject`, "POST", { reason })}>
              見送る
            </Button>
          </div>
          {viaX && (!xConfigured || dryRun) && (
            <ManualPath
              intent={intentUrl(text, post.kind === "reply" ? post.replyToExternalId : null)}
              note={xConfigured ? "練習モード中でも、自分のXから手で投稿できます。" : "XのAPIが未設定なので、Xの投稿画面を開いて自分で投稿できます。"}
              postedUrl={postedUrl}
              setPostedUrl={setPostedUrl}
              loading={pending && busy === "published"}
              onDone={() => act("published", `/api/growth/posts/${post.id}/published`, "POST", { url: postedUrl })}
            />
          )}
        </div>
      )}

      {post.status === "approved" && !post.dryRun && !viaX && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs text-text-muted">この返信先にはAPIがありません。本文をコピーして、返信先のページで自分で投稿してください。</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void navigator.clipboard?.writeText(post.text)}>本文をコピー</Button>
            <Button size="sm" variant="primary" loading={pending && busy === "published"} onClick={() => act("published", `/api/growth/posts/${post.id}/published`, "POST", { url: "" })}>
              投稿した
            </Button>
          </div>
        </div>
      )}

      {post.status === "published" && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            {post.externalUrl && (
              <a href={post.externalUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                公開した投稿を開く
              </a>
            )}
            {attribution && (
              <span>
                サイト訪問 <span className="font-medium tabular-nums text-text">{attribution.visits}</span> ・ 登録{" "}
                <span className="font-medium tabular-nums text-text">{attribution.signups}</span>
              </span>
            )}
            {post.metrics &&
              METRIC_FIELDS.filter((f) => post.metrics![f.key] !== null).map((f) => (
                <span key={f.key}>
                  {f.label} <span className="font-medium tabular-nums text-text">{post.metrics![f.key]}</span>
                </span>
              ))}
          </div>
          <MetricsForm post={post} loading={pending && busy === "metrics"} onSave={(values) => act("metrics", `/api/growth/posts/${post.id}/metrics`, "PUT", values)} />
        </div>
      )}

      {error && <Status tone="error">{error}</Status>}
    </li>
  );
}

function StatusBadge({ post }: { post: Post }) {
  if (post.status === "draft") return <Badge tone="attention">承認待ち</Badge>;
  if (post.status === "approved") return <Badge>{post.dryRun ? "練習で承認" : "承認済み・未投稿"}</Badge>;
  if (post.status === "published") return <Badge tone="positive">公開済み</Badge>;
  if (post.status === "failed") return <Badge tone="negative">送信失敗</Badge>;
  return <Badge>見送り</Badge>;
}

function ManualPath({
  intent,
  note,
  postedUrl,
  setPostedUrl,
  loading,
  onDone,
}: {
  intent: string;
  note: string;
  postedUrl: string;
  setPostedUrl: (value: string) => void;
  loading: boolean;
  onDone: () => void;
}) {
  return (
    <Disclosure summary="自分でXに投稿する">
      <div className="flex flex-col gap-2 pt-2">
        <p className="text-xs text-text-muted">{note}投稿したら、そのURLを貼ると結果を追えます。</p>
        <div className="flex flex-wrap items-center gap-2">
          <a href={intent} target="_blank" rel="noopener noreferrer" className="text-xs font-medium underline-offset-2 hover:underline">
            Xの投稿画面を開く
          </a>
          <input
            aria-label="投稿したURL"
            placeholder="https://x.com/…/status/…"
            value={postedUrl}
            onChange={(e) => setPostedUrl(e.target.value)}
            className={`${controlClass} max-w-72 py-1.5 text-xs`}
          />
          <Button size="sm" loading={loading} onClick={onDone}>
            投稿した
          </Button>
        </div>
      </div>
    </Disclosure>
  );
}

function MetricsForm({ post, loading, onSave }: { post: Post; loading: boolean; onSave: (values: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(METRIC_FIELDS.map((f) => [f.key, post.metrics?.[f.key]?.toString() ?? ""])),
  );
  return (
    <Disclosure summary={post.metrics?.source === "x_api" ? "数字を手で直す" : "Xのアナリティクスの数字を入力する"}>
      <div className="flex flex-col gap-2 pt-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {METRIC_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-0.5 text-xs text-text-muted">
              {f.label}
              <input
                inputMode="numeric"
                value={values[f.key]}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={`${controlClass} py-1 text-xs tabular-nums`}
              />
            </label>
          ))}
        </div>
        <div>
          <Button size="sm" loading={loading} onClick={() => onSave(values)}>
            保存する
          </Button>
        </div>
      </div>
    </Disclosure>
  );
}
