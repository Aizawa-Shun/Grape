"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";
import { cx, focusRing } from "@/components/ui/cx";
import type { OverridableKey } from "@/core/settings";

export type SettingsValues = Record<OverridableKey, string>;

interface FieldSpec {
  key: OverridableKey;
  label: string;
  hint: string;
  options?: { value: string; label: string }[];
  inputMode?: "numeric";
}

interface Section {
  title: string;
  description: ReactNode;
  fields: FieldSpec[];
}

/**
 * Labels describe what the setting *does*, not what the variable is called.
 * The variable name is still shown, quietly, because it is what the README and
 * .env.example talk about and someone will need to match them up.
 */
/** `monthSpendUsd` is only known at render time, so this is a function rather than a constant. */
function buildSections(monthSpendUsd: number): Section[] {
  return [
  {
    title: "AIの接続先",
    description: "「なぜそうなっているか」の説明文と、投稿の文面を書く相手です。",
    fields: [
      {
        key: "LLM_PROVIDER",
        label: "どこのAIを使うか",
        hint: "手元のモデル（Ollama）は無料ですが遅く、APIは速いぶん費用がかかります。",
        options: [
          { value: "anthropic", label: "Anthropic（Claude）" },
          { value: "ollama", label: "手元のモデル（Ollama）" },
          { value: "openai-compat", label: "OpenAI互換のサービス" },
        ],
      },
      { key: "ANTHROPIC_MODEL", label: "Anthropicのモデル名", hint: "例: claude-opus-5" },
      {
        key: "OLLAMA_BASE_URL",
        label: "Ollamaのアドレス",
        hint: "手元でOllamaを動かしている場所。ふつうは変えません。",
      },
      {
        key: "OLLAMA_MODEL",
        label: "Ollamaのモデル名",
        hint: "小さいモデルほど速く、そのぶん提案の質は落ちます。",
      },
      { key: "OPENAI_BASE_URL", label: "OpenAI互換のアドレス", hint: "LM StudioやvLLMなど。" },
      { key: "OPENAI_MODEL", label: "OpenAI互換のモデル名", hint: "例: gpt-4o-mini" },
    ],
  },
  {
    title: "支出の上限",
    description: (
      <>
        今月はこれまでに約{" "}
        <span className="font-medium tabular-nums text-text">${monthSpendUsd.toFixed(2)}</span>{" "}
        使っています（Ollamaの利用分は含みません。実際の請求額とは差が出ることがあります）。
      </>
    ),
    fields: [
      {
        key: "LLM_MONTHLY_BUDGET_USD",
        label: "毎月の上限額（ドル）",
        hint: "この額に達すると、来月まで新しいAI呼び出しを止めます。",
        inputMode: "numeric",
      },
    ],
  },
  {
    title: "待ち時間",
    description: "遅いモデルを使うときに効いてきます。",
    fields: [
      {
        key: "LLM_TIMEOUT_MS",
        label: "AIの返事を待つ時間（ミリ秒）",
        hint: "手元の小さいモデルは1分近くかかることがあります。",
        inputMode: "numeric",
      },
      {
        key: "LLM_HEALTH_TIMEOUT_MS",
        label: "接続確認を待つ時間（ミリ秒）",
        hint: "短くしておかないと、AIが固まったときに状態確認まで止まります。",
        inputMode: "numeric",
      },
      {
        key: "LLM_MAX_REPAIRS",
        label: "返事が壊れたときの再依頼の回数",
        hint: "0〜3。増やすほど粘りますが、そのぶん待たされます。",
        inputMode: "numeric",
      },
    ],
  },
  {
    title: "計測",
    description: "サイトに貼ったコードから、訪問がどこへ届くか。",
    fields: [
      {
        key: "INGEST_BASE_URL",
        label: "訪問データの受け取り先",
        hint: "あなたのサイトから見えるアドレス。`pnpm tunnel` で出たアドレスを入れます。",
      },
      {
        key: "COLD_START_MIN_SESSIONS",
        label: "割合を信じはじめる訪問数",
        hint: "これより少ないうちは、離脱の割合を出さずにサイト自体を見て判断します。",
        inputMode: "numeric",
      },
      {
        key: "GRAPE_EVENT_RETENTION_DAYS",
        label: "訪問データを残す日数",
        hint: "これより古いものは自動で消えます。",
        inputMode: "numeric",
      },
    ],
  },
  {
    title: "記録",
    description: "うまくいかないときに、何が起きたかを追うための設定です。",
    fields: [
      {
        key: "GRAPE_LOG_LEVEL",
        label: "ログの詳しさ",
        hint: "AIが実際に何を返したかまで見たいときは debug にします。",
        options: [
          { value: "debug", label: "debug — 全部" },
          { value: "info", label: "info — ふつう" },
          { value: "warn", label: "warn — 気になることだけ" },
          { value: "error", label: "error — 失敗だけ" },
        ],
      },
    ],
  },
  ];
}

export function SettingsForm({
  values,
  defaults,
  overridden,
  monthSpendUsd,
}: {
  /** What is in effect right now. */
  values: SettingsValues;
  /** What .env alone would give — used for "戻す" and for the source badge. */
  defaults: SettingsValues;
  overridden: OverridableKey[];
  /** This calendar month's estimated LLM spend so far — see core/llm/budget.ts. */
  monthSpendUsd: number;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<SettingsValues>(values);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sections = buildSections(monthSpendUsd);

  const overriddenNow = new Set(overridden);
  const dirty = (Object.keys(draft) as OverridableKey[]).some((key) => draft[key] !== values[key]);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      // A value equal to the .env default is sent as "" so the row is removed
      // rather than kept as a copy that silently stops tracking the file.
      const patch = Object.fromEntries(
        (Object.keys(draft) as OverridableKey[]).map((key) => [
          key,
          draft[key] === defaults[key] ? "" : draft[key],
        ]),
      );

      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "保存できませんでした。");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-8">
      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-medium">{section.title}</h2>
            <p className="text-xs text-text-muted">{section.description}</p>
          </div>

          {/*
            One bordered group per section. As a plain run of inputs this page
            was ~2,700px of undifferentiated column, and the section headings
            read as just more text in it; a box is what makes "these four
            belong together" visible while scrolling past.
          */}
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-md border border-border shadow-card">
            {section.fields.map((field) => (
              <Row
                key={field.key}
                field={field}
                value={draft[field.key]}
                isDefault={draft[field.key] === defaults[field.key]}
                wasOverridden={overriddenNow.has(field.key)}
                onChange={(value) => {
                  setSaved(false);
                  setDraft((d) => ({ ...d, [field.key]: value }));
                }}
                onReset={() => {
                  setSaved(false);
                  setDraft((d) => ({ ...d, [field.key]: defaults[field.key] }));
                }}
              />
            ))}
          </div>
        </section>
      ))}

      {/*
        Pinned to the bottom of the viewport. The save button used to sit only
        at the end of the form, so changing the first field meant scrolling
        past every other one to commit it — and the page gives no other sign
        that an edit is still uncommitted.
      */}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-surface/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Button variant="primary" onClick={save} loading={pending} disabled={!dirty}>
          {pending ? "保存しています…" : "保存する"}
        </Button>
        {dirty && (
          <Button
            disabled={pending}
            onClick={() => {
              setDraft(values);
              setError(null);
            }}
          >
            変更をやめる
          </Button>
        )}
        {error ? (
          <Status tone="error">{error}</Status>
        ) : saved && !dirty ? (
          <Status>保存しました。次の操作から反映されます。</Status>
        ) : dirty ? (
          <Status>まだ保存していません。</Status>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  field,
  value,
  isDefault,
  wasOverridden,
  onChange,
  onReset,
}: {
  field: FieldSpec;
  value: string;
  isDefault: boolean;
  wasOverridden: boolean;
  onChange: (value: string) => void;
  onReset: () => void;
}) {
  const id = `setting-${field.key}`;
  const hintId = `${id}-hint`;
  const control =
    "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text " +
    "placeholder:text-text-subtle disabled:opacity-50 " +
    focusRing;

  return (
    <div className="flex flex-col gap-1.5 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {field.label}
        </label>
        {wasOverridden && <Badge tone="attention">ここで変更中</Badge>}
        <code className="ml-auto font-mono text-[11px] text-text-subtle">{field.key}</code>
      </div>

      <p id={hintId} className="text-xs text-text-muted">
        {field.hint}
      </p>

      <div className="flex items-center gap-2">
        {field.options ? (
          <select
            id={id}
            aria-describedby={hintId}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cx(control, "appearance-none")}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            aria-describedby={hintId}
            inputMode={field.inputMode}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={control}
          />
        )}

        {!isDefault && (
          <Button size="sm" onClick={onReset} className="shrink-0">
            戻す
          </Button>
        )}
      </div>
    </div>
  );
}
