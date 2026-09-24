"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import type { DraftFields, DraftNotes, ReviewField } from "@/core/context/review";

/**
 * Labels are what the reader is being asked, not the internal what/who/why/how
 * — the same four fields every diagnosis reasons over (context/snapshot.ts).
 */
const FIELDS: { key: ReviewField; label: string; hint: string; placeholder: string }[] = [
  {
    key: "what",
    label: "サービス概要",
    hint: "どんなサービスか、簡潔に説明してください。",
    placeholder: "例: ブラウザでチェスを対局できるWebサービス",
  },
  {
    key: "who",
    label: "想定顧客",
    hint: "誰に使ってほしいサービスですか。",
    placeholder: "例: チェスを学び始めた初心者",
  },
  {
    key: "why",
    label: "解決する課題",
    hint: "そのサービスが解決する課題は何ですか。",
    placeholder: "例: 棋譜を人に見せて相談する手段が無い",
  },
  {
    key: "how",
    label: "使い方",
    hint: "使い始めるまでの流れや、料金・利用条件があれば。",
    placeholder: "例: サイトを開いて「対局する」を押すだけ。登録は不要",
  },
];

const LABEL: Record<ReviewField, string> = Object.fromEntries(
  FIELDS.map((field) => [field.key, field.label]),
) as Record<ReviewField, string>;

function listOf(fields: ReviewField[]): string {
  return fields.map((field) => LABEL[field]).join("、");
}

interface Props {
  productId: string;
  initialName: string;
  initialUrl: string;
  /** Already passed through editableValue — no sentinel reaches an input. */
  initialFields: DraftFields;
  notes: DraftNotes;
}

/**
 * The AI's draft, laid out to be corrected rather than read.
 *
 * Saving does two things through two existing endpoints — the product's own
 * name and URL (PATCH /api/products/[id]) and the four fields as a new,
 * human-confirmed context version (PUT .../context) — so a confirmation here
 * is the same record the product page's editor writes, not a second kind.
 *
 * A changed URL is the exception. The four fields describe the site that was
 * read, so saving them against a different address would pin a description
 * to a site it was never about. Instead the address is saved and the new site
 * is read, and this screen comes back with a fresh draft for it.
 */
export function ReviewForm({ productId, initialName, initialUrl, initialFields, notes }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const [fields, setFields] = useState<DraftFields>(initialFields);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const urlChanged = url.trim() !== initialUrl;
  const complete =
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    (urlChanged || FIELDS.every((field) => fields[field.key].trim().length > 0));

  async function send(path: string, method: string, body?: unknown): Promise<boolean> {
    const response = await fetch(path, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.ok) return true;
    const payload = await response.json().catch(() => ({}));
    setError(payload.error ?? "保存できませんでした。もう一度お試しください。");
    return false;
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const patch: { name?: string; url?: string } = {};
      if (name.trim() !== initialName) patch.name = name.trim();
      if (urlChanged) patch.url = url.trim();
      if (Object.keys(patch).length > 0) {
        if (!(await send(`/api/products/${productId}`, "PATCH", patch))) return;
      }

      if (urlChanged) {
        if (!(await send(`/api/products/${productId}/reread`, "POST"))) return;
        router.refresh();
        return;
      }

      const trimmed: DraftFields = {
        what: fields.what.trim(),
        who: fields.who.trim(),
        why: fields.why.trim(),
        how: fields.how.trim(),
      };
      if (!(await send(`/api/products/${productId}/context`, "PUT", trimmed))) return;

      router.push(`/products/${productId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <DraftCallout notes={notes} />

      <Field label="サービス名">
        {(props) => (
          <input
            {...props}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={controlClass}
          />
        )}
      </Field>

      <Field
        label="URL"
        hint={
          urlChanged
            ? "URLを変えると、保存したあとに新しいURLのサイトを読み直し、下の内容も読み直した結果に置き換わります。"
            : "https:// が無い場合は自動で補います。"
        }
      >
        {(props) => (
          <input
            {...props}
            required
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className={controlClass}
          />
        )}
      </Field>

      {FIELDS.map((field) => (
        <Field key={field.key} label={field.label} hint={field.hint}>
          {(props) => (
            <textarea
              {...props}
              required={!urlChanged}
              disabled={urlChanged}
              rows={3}
              placeholder={field.placeholder}
              value={fields[field.key]}
              onChange={(e) => setFields((current) => ({ ...current, [field.key]: e.target.value }))}
              className={controlClass}
            />
          )}
        </Field>
      ))}

      {error && <Status tone="error">{error}</Status>}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={pending} disabled={!complete}>
          {pending ? "保存しています…" : urlChanged ? "保存して読み直す" : "この内容で保存する"}
        </Button>
        <span className="text-xs text-text-muted">
          保存した内容が、Grapeがあなたのサービスを理解する土台になります。
        </span>
      </div>
    </form>
  );
}

function DraftCallout({ notes }: { notes: DraftNotes }) {
  if (notes.source === "human") {
    return (
      <Callout title="あなたが確認した内容です">
        直したいところがあれば、ここで書き換えて保存してください。
      </Callout>
    );
  }

  // Nothing found at all is not a draft, and should not be announced as one:
  // almost always the address is wrong or the site did not answer.
  if (notes.blank.length === FIELDS.length) {
    return (
      <Callout tone="attention" title="ページから内容を読み取れませんでした">
        <p>
          URLが合っているか、サイトが開ける状態かを確かめてください。URLを直して保存すると読み直します。
          このまま自分で書いて保存することもできます。
        </p>
      </Callout>
    );
  }

  return (
    <Callout title={notes.source === "ai" ? "AIがページを読み取って下書きしました" : "ページの内容から下書きしました"}>
      <p>
        内容を確認し、違うところだけ直してください。ここで保存した内容が、Grapeがあなたのサービスを理解する土台になります。
      </p>
      {notes.source === "rules" && (
        <p className="mt-2">
          AIは使っていないので、サイトの説明文や見出しをそのまま並べています。
        </p>
      )}
      {notes.guessed.length > 0 && (
        <p className="mt-2">
          サイトに書かれていなかったため、AIが推測で書いた項目:{" "}
          <span className="font-medium text-text">{listOf(notes.guessed)}</span>
        </p>
      )}
      {notes.blank.length > 0 && (
        <p className="mt-2">
          ページから読み取れなかったため空欄にしている項目:{" "}
          <span className="font-medium text-text">{listOf(notes.blank)}</span>
        </p>
      )}
    </Callout>
  );
}
