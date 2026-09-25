"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

import { send } from "./request";

/**
 * A conversation the person found themselves, pasted in. Without X's paid
 * read access this is how an X post reaches the feed — and it gets the same
 * relevance judgment, with reasons, as anything the agent found.
 */
export function PasteOpportunity({ productId }: { productId: string }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await send(`/api/growth/${productId}/opportunities`, "POST", { url: url.trim(), text: text.trim() });
      if (!result.ok) return setError(result.error);
      setUrl("");
      setText("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <input aria-label="投稿のURL" placeholder="https://x.com/…/status/…" value={url} onChange={(e) => setUrl(e.target.value)} required className={controlClass} />
      <textarea aria-label="投稿の本文" placeholder="投稿の本文を貼り付け" value={text} onChange={(e) => setText(e.target.value)} required rows={3} className={controlClass} />
      <div>
        <Button type="submit" size="sm" loading={pending}>
          {pending ? "判断しています…" : "追加して関連度を判断する"}
        </Button>
      </div>
      {error && <Status tone="error">{error}</Status>}
    </form>
  );
}
