"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Spinner } from "@/components/ui/spinner";

/** How often to ask the server whether the crawl has finished. */
const POLL_MS = 2_000;
/** Past this the wait is unusual enough to say so — a slow site, or a model taking its time. */
const SLOW_AFTER_SEC = 30;

/**
 * What the product page shows while the site is still being read.
 *
 * The work runs server-side and is recorded on the row, so this is a view of
 * progress rather than a spinner attached to one request. That is what makes
 * it survive a reload, a tab close, or a walk to another page and back.
 *
 * Refreshing the route rather than polling an endpoint of its own — the page
 * already reads `setupStatus` off the row it renders, so a refresh is both the
 * check and the update, with no second code path to keep in agreement.
 *
 * It is also what starts the crawl: see the first effect below.
 */
export function SetupProgress({
  productId,
  url,
  compact = false,
}: {
  productId: string;
  url: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [seconds, setSeconds] = useState(0);

  // The crawl runs inside this request (see api/products/[id]/setup). Asked
  // once per mount; a second watcher, or a reload mid-crawl, gets "already
  // running" and simply keeps polling below until the row changes.
  //
  // Deliberately never aborted on unmount: leaving the page must not cancel a
  // crawl someone asked for. The request finishes on the server either way.
  useEffect(() => {
    void fetch(`/api/products/${productId}/setup`, { method: "POST" })
      .then(() => router.refresh())
      .catch(() => undefined);
  }, [productId, router]);

  useEffect(() => {
    const tick = setInterval(() => setSeconds((value) => value + 1), 1_000);
    const poll = setInterval(() => router.refresh(), POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [router]);

  // Re-reading a product that already has a context: the previous answers are
  // right below this and still usable, so the wait gets one line rather than a
  // screen of skeleton standing in for content that is already there.
  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border bg-surface-sunken px-3 py-2">
        <Spinner className="text-accent" />
        <span className="text-xs font-medium">読み直しています</span>
        <span className="text-xs tabular-nums text-text-subtle">{seconds}秒</span>
        <span className="text-xs text-text-muted">下の内容は前回のものです。</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-surface p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Spinner className="text-accent" />
        <span className="text-sm font-medium">サイトを読んでいます</span>
        <span className="text-xs tabular-nums text-text-subtle">{seconds}秒</span>
      </div>

      <p className="text-xs text-text-muted">
        {url} を開いて、何のサービスかを整理しています。
        <br />
        このページを閉じても進みます。あとで開き直せば結果が出ています。
      </p>

      {/*
        Four bars for the four answers being assembled (what / who / why /
        how), in the same stacked shape the finished table has — so the wait
        reads as "this is filling in" rather than as an unrelated spinner.
      */}
      <div aria-hidden="true" className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex items-center gap-3">
            <div className="h-3 w-24 shrink-0 animate-pulse rounded bg-surface-sunken" />
            <div
              className="h-3 flex-1 animate-pulse rounded bg-surface-sunken"
              // Staggered so the row of bars reads as one thing filling in
              // rather than four identical blocks flashing in lockstep.
              style={{ animationDelay: `${row * 150}ms`, maxWidth: `${92 - row * 11}%` }}
            />
          </div>
        ))}
      </div>

      {seconds >= SLOW_AFTER_SEC && (
        <p className="text-xs text-text-muted">
          時間がかかっています。ページ数が多いサイトや、JavaScriptで描画されるサイトでは数分かかることがあります。
        </p>
      )}
    </div>
  );
}
