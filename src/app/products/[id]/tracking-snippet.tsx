"use client";

import { useState } from "react";

interface Props {
  productId: string;
  ingestBaseUrl: string;
}

/**
 * The snippet is regenerated from the current INGEST_BASE_URL on every
 * render rather than stored anywhere — during development that origin is a
 * cloudflared quick tunnel URL that changes on every restart (see
 * .env.example), so anything cached would go stale silently. This component
 * always shows the snippet that matches whatever the server is configured
 * with right now.
 */
export function TrackingSnippet({ productId, ingestBaseUrl }: Props) {
  const [copied, setCopied] = useState(false);
  const isLocalTunnel = ingestBaseUrl.includes("localhost") || ingestBaseUrl.includes("127.0.0.1");

  const snippet = [
    `<script>window.grape=window.grape||function(){(window.grape.q=window.grape.q||[]).push(arguments)}</script>`,
    `<script async src="${ingestBaseUrl}/g.js" data-product="${productId}"></script>`,
  ].join("\n");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can be unavailable (insecure context, permissions);
      // the code block below is still selectable by hand.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {isLocalTunnel && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          INGEST_BASE_URL が {ingestBaseUrl} のままです。このサイトの外部ページからイベントを送るには、公開URLが必要です:
          <br />
          <code className="mt-1 inline-block rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">
            cloudflared tunnel --url http://localhost:3000
          </code>
          <br />
          で出た https://*.trycloudflare.com を .env の INGEST_BASE_URL に設定し、サーバーを再起動してからこのページを再読み込みしてください。
        </p>
      )}

      <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
        <code>{snippet}</code>
      </pre>

      <div className="flex items-center gap-2">
        <button
          onClick={handleCopy}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700"
        >
          {copied ? "コピーしました" : "コピー"}
        </button>
        <span className="text-xs text-zinc-400">サイトの &lt;head&gt; か &lt;/body&gt; 直前に貼り付けてください</span>
      </div>
    </div>
  );
}
