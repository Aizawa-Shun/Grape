"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import type { ProductKnowledge } from "@/db/schema";

import { send } from "../request";

const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

/**
 * "あなたのSaaSはこう理解しました" — and the place to say where it is wrong.
 * A correction is kept over any later re-analysis, and every agent reads it.
 */
export function KnowledgeEditor({ productId, knowledge }: { productId: string; knowledge: ProductKnowledge }) {
  const router = useRouter();
  const [form, setForm] = useState({
    summary: knowledge.summary,
    problem: knowledge.problem,
    solution: knowledge.solution,
    targetUser: knowledge.targetUser,
    usp: knowledge.usp.join("\n"),
    useCases: knowledge.useCases.join("\n"),
    features: knowledge.features.join("\n"),
    pricing: knowledge.pricing,
    angles: knowledge.marketingAngles.map((a) => `${a.name}: ${a.description}`).join("\n"),
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: e.target.value }));
  };

  function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await send(`/api/growth/${productId}/knowledge`, "PUT", {
        summary: form.summary,
        problem: form.problem,
        solution: form.solution,
        targetUser: form.targetUser,
        usp: lines(form.usp),
        useCases: lines(form.useCases),
        features: lines(form.features),
        pricing: form.pricing,
        marketingAngles: lines(form.angles).map((line) => {
          const [name, ...rest] = line.split(/[:：]/);
          return { name: name.trim(), description: rest.join(":").trim() || name.trim() };
        }),
      });
      if (!result.ok) return setError(result.error);
      setSaved(true);
      router.refresh();
    });
  }

  const area = (key: keyof typeof form, label: string, hint?: string, rows = 3) => (
    <Field label={label} hint={hint}>
      {(props) => <textarea {...props} rows={rows} value={form[key]} onChange={set(key)} className={controlClass} />}
    </Field>
  );

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {area("summary", "プロダクトの概要", undefined, 4)}
      <div className="grid gap-4 md:grid-cols-2">
        {area("problem", "解決する問題")}
        {area("solution", "解決のしかた")}
      </div>
      {area("targetUser", "想定ユーザー", undefined, 2)}
      <div className="grid gap-4 md:grid-cols-2">
        {area("usp", "USP", "1行に1つ", 4)}
        {area("useCases", "利用シーン", "1行に1つ", 4)}
      </div>
      {area("features", "主な機能", "1行に1つ", 4)}
      <Field label="料金">{(props) => <input {...props} value={form.pricing} onChange={set("pricing")} className={controlClass} />}</Field>
      {area("angles", "マーケティングの切り口", "1行に1つ。「名前: 説明」の形で", 5)}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" loading={pending}>
          この内容で確定する
        </Button>
        {saved && <span className="text-xs text-positive">保存しました。以後のすべての提案に使われます。</span>}
      </div>
      {error && <Status tone="error">{error}</Status>}
    </form>
  );
}
