"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

interface Props {
  productId: string;
  ingestBaseUrl: string;
}

/**
 * Regenerated on every render rather than stored: during development the
 * receiving address is a quick tunnel URL that changes on every restart, so a
 * cached snippet would go stale without saying so. What is shown here always
 * matches what the server is configured with right now.
 */
export function TrackingSnippet({ productId, ingestBaseUrl }: Props) {
  const [copied, setCopied] = useState(false);
  const notReachable = ingestBaseUrl.includes("localhost") || ingestBaseUrl.includes("127.0.0.1");

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
      // Clipboard access can be unavailable (insecure context, permissions);
      // the code block below is still selectable by hand.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {notReachable && (
        <Callout tone="attention" title="このままだと、あなたのサイトから届きません">
          <p>
            いまの受け取り先は <code className="font-mono">{ingestBaseUrl}</code> で、
            あなたのパソコンの中だけのアドレスです。インターネット上のサイトから見えるアドレスが要ります。
          </p>
          <p className="mt-2">別のターミナルでこれを実行すると、公開アドレスが1つ表示されます:</p>
          <code className="mt-1 inline-block rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-text">
            pnpm tunnel
          </code>
          <p className="mt-2">
            表示された https://…trycloudflare.com を、下の「計測」にある「訪問データの受け取り先」に貼って保存してください。
            再起動は要りません。
          </p>
        </Callout>
      )}

      <pre className="overflow-x-auto rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs">
        <code>{snippet}</code>
      </pre>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={handleCopy}>
          {copied ? "コピーしました" : "コピーする"}
        </Button>
        <span className="text-xs text-text-muted">
          あなたのサイトの全ページに貼ります（&lt;head&gt; の中か &lt;/body&gt; の直前）
        </span>
      </div>

      {/*
        The one call a site has to make by hand. It used to be mentioned only
        in the key-event field's hint, so someone who pasted the snippet and
        stopped had a funnel whose 使ってもらう stage could never move.
      */}
      <p className="text-xs text-text-muted">
        ページを見たことは自動で届きます。「ゴールの操作」（登録完了など）だけは、それが起きたところで{" "}
        <code className="font-mono">grape(&apos;track&apos;, &apos;signup&apos;)</code>{" "}
        のように呼んでください。名前は「ゴールの操作」と揃えます。
      </p>
    </div>
  );
}
