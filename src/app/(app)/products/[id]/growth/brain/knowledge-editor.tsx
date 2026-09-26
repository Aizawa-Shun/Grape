"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import type { Fact, KnowledgeTopic, ProductKnowledge } from "@/db/schema";

import { send } from "../request";

const TOPICS: { key: KnowledgeTopic; label: string }[] = [
  { key: "what", label: "何をするものか" },
  { key: "targetUsers", label: "誰のためのものか" },
  { key: "problems", label: "解決する問題" },
  { key: "benefits", label: "得られる価値" },
  { key: "features", label: "主な機能" },
  { key: "differentiators", label: "他との違い" },
  { key: "useCases", label: "使われ方" },
  { key: "pricing", label: "料金" },
  { key: "proof", label: "実績・証拠" },
];

type Draft = Record<KnowledgeTopic, Fact[]>;

function initial(knowledge: ProductKnowledge): Draft {
  return {
    what: knowledge.what ? [knowledge.what] : [],
    targetUsers: knowledge.targetUsers,
    problems: knowledge.problems,
    benefits: knowledge.benefits,
    features: knowledge.features,
    differentiators: knowledge.differentiators,
    useCases: knowledge.useCases,
    pricing: knowledge.pricing,
    proof: knowledge.proof,
  };
}

const owner = (text: string): Fact => ({ text, status: "known", basis: "owner", evidence: [] });

/**
 * Correct what Grape understood. Confirming a guess makes it the owner's fact;
 * rewriting any fact makes it the owner's words. A fact can never be made to
 * claim a site source it has no quote for — the server enforces that too.
 */
export function KnowledgeEditor({ productId, knowledge }: { productId: string; knowledge: ProductKnowledge }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => initial(knowledge));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = (topic: KnowledgeTopic, facts: Fact[]) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [topic]: facts }));
  };

  function save() {
    setError(null);
    startTransition(async () => {
      const clean = (facts: Fact[]) => facts.filter((f) => f.text.trim());
      const result = await send(`/api/growth/${productId}/knowledge`, "PUT", {
        what: clean(draft.what)[0] ?? null,
        targetUsers: clean(draft.targetUsers),
        problems: clean(draft.problems),
        benefits: clean(draft.benefits),
        features: clean(draft.features),
        differentiators: clean(draft.differentiators),
        useCases: clean(draft.useCases),
        pricing: clean(draft.pricing),
        proof: clean(draft.proof),
      });
      if (!result.ok) return setError(result.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {TOPICS.map(({ key, label }) => (
        <div key={key} className="flex flex-col gap-2">
          <p className="text-sm font-medium">{label}</p>
          {draft[key].map((fact, index) => (
            <div key={index} className="flex flex-col gap-1 sm:flex-row sm:items-start">
              <input
                aria-label={label}
                value={fact.text}
                onChange={(e) => update(key, draft[key].map((f, i) => (i === index ? owner(e.target.value) : f)))}
                className={controlClass}
              />
              <div className="flex shrink-0 gap-1">
                {fact.status === "assumption" && (
                  <Button size="sm" variant="ghost" onClick={() => update(key, draft[key].map((f, i) => (i === index ? owner(f.text) : f)))}>
                    正しい
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => update(key, draft[key].filter((_, i) => i !== index))}>
                  削除
                </Button>
              </div>
              <span className="text-xs text-text-subtle sm:w-20 sm:pt-2">
                {fact.basis === "owner" ? "あなた" : fact.status === "known" ? "サイト" : "仮説"}
              </span>
            </div>
          ))}
          {(key !== "what" || draft.what.length === 0) && (
            <div>
              <Button size="sm" variant="ghost" onClick={() => update(key, [...draft[key], owner("")])}>
                ＋ 追加
              </Button>
            </div>
          )}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button variant="primary" loading={pending} onClick={save}>
          この内容で確定する
        </Button>
        {saved && <span className="text-xs text-positive">保存しました。以後の提案はこの内容を前提にします。</span>}
      </div>
      {error && <Status tone="error">{error}</Status>}
    </div>
  );
}
