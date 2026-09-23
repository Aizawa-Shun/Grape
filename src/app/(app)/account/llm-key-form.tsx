"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import type { LLMProviderName } from "@/env";

interface ProviderSpec {
  provider: LLMProviderName;
  label: string;
  hint: string;
  placeholder: string;
}

const PROVIDERS: ProviderSpec[] = [
  {
    provider: "anthropic",
    label: "Anthropic（Claude）",
    hint: "console.anthropic.com で発行したキーです。",
    placeholder: "sk-ant-...",
  },
  {
    provider: "openai-compat",
    label: "OpenAI互換のサービス",
    hint: "OpenAI本体、またはLM Studio/vLLMなど自分で立てたサーバー用です。ローカルサーバーなら空のままで構いません。",
    placeholder: "sk-...",
  },
];

/**
 * Each account's own credential for the service /settings picked — not a
 * shared instance key any more (see core/auth/users.ts). Write-only, same
 * shape as a password field: this never learns the key that is already on
 * file, only whether one is ("設定済み"), so there is nothing here for a
 * stolen session to read back out.
 */
export function LlmKeyForm({ status }: { status: Record<LLMProviderName, boolean> }) {
  return (
    <div className="flex flex-col gap-6">
      {PROVIDERS.map((spec) => (
        <ProviderKeyRow key={spec.provider} spec={spec} isSet={status[spec.provider]} />
      ))}
    </div>
  );
}

function ProviderKeyRow({ spec, isSet }: { spec: ProviderSpec; isSet: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"saved" | "cleared" | null>(null);
  const [pending, startTransition] = useTransition();

  function save(apiKey: string | null) {
    setError(null);
    setDone(null);

    startTransition(async () => {
      const response = await fetch("/api/account/llm-keys", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: spec.provider, apiKey }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body.error ?? "保存できませんでした。");
        return;
      }
      setValue("");
      setDone(apiKey ? "saved" : "cleared");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) save(value.trim());
      }}
      className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{spec.label}</span>
        <span className="text-xs text-text-muted">{isSet ? "設定済み" : "未設定"}</span>
      </div>

      <Field label={isSet ? "新しいキーに置き換える" : "APIキー"} hint={spec.hint}>
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="off"
            placeholder={spec.placeholder}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setDone(null);
            }}
            className={controlClass}
          />
        )}
      </Field>

      {error && <Status tone="error">{error}</Status>}
      {done === "saved" && <Status>保存しました。</Status>}
      {done === "cleared" && <Status>削除しました。</Status>}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={pending} disabled={!value.trim()}>
          {pending ? "保存中…" : "保存する"}
        </Button>
        {isSet && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => save(null)}
          >
            削除する
          </Button>
        )}
      </div>
    </form>
  );
}
