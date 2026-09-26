"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";
import type { OpenQuestion } from "@/db/schema";

import { send } from "../request";

/**
 * Grape's questions, answered in place. An answer becomes the owner's own
 * fact — known, not guessed — and every later post and strategy can use it.
 */
export function QuestionsForm({ productId, questions }: { productId: string; questions: OpenQuestion[] }) {
  if (questions.length === 0) return <p className="text-sm text-text-muted">いまGrapeが聞きたいことはありません。</p>;
  return (
    <ul className="flex flex-col gap-3">
      {questions.map((question) => (
        <QuestionItem key={question.id} productId={productId} question={question} />
      ))}
    </ul>
  );
}

function QuestionItem({ productId, question }: { productId: string; question: OpenQuestion }) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(value: string) {
    setError(null);
    startTransition(async () => {
      const result = await send(`/api/growth/${productId}/questions`, "POST", { questionId: question.id, answer: value });
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 shadow-card">
      <p className="text-sm font-medium">{question.question}</p>
      <p className="text-xs text-text-muted">{question.whyItMatters}</p>
      {question.guess && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-text-muted">Grapeの推測: {question.guess}</span>
          <Button size="sm" variant="ghost" loading={pending} onClick={() => submit(question.guess!)}>
            この推測で合っている
          </Button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (answer.trim()) submit(answer);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input aria-label="回答" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="あなたの答え" className={controlClass} />
        <Button type="submit" size="sm" loading={pending} className="sm:shrink-0">
          答える
        </Button>
      </form>
      {error && <Status tone="error">{error}</Status>}
    </li>
  );
}
