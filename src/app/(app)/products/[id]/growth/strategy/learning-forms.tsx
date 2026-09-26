"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { Status } from "@/components/ui/status";

import { send } from "../request";

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (path: string, method: "POST" | "DELETE", body?: unknown, after?: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await send(path, method, body);
      if (!result.ok) return setError(result.error);
      after?.();
      router.refresh();
    });
  };
  return { run, error, pending };
}

/** Something the owner already knows about their market, added to the Brain. */
export function OwnerLearningForm({ productId }: { productId: string }) {
  const [statement, setStatement] = useState("");
  const [direction, setDirection] = useState<"works" | "fails">("works");
  const { run, error, pending } = useAction();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(`/api/growth/${productId}/learnings`, "POST", { statement, direction }, () => setStatement(""));
      }}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <select aria-label="効いたか" value={direction} onChange={(e) => setDirection(e.target.value as "works" | "fails")} className={`${controlClass} sm:w-36`}>
          <option value="works">効いた</option>
          <option value="fails">効かなかった</option>
        </select>
        <input
          aria-label="知見"
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          placeholder="例: 値引きの告知は反応がなかった"
          className={controlClass}
        />
        <Button type="submit" size="sm" loading={pending} className="sm:shrink-0">
          加える
        </Button>
      </div>
      {error && <Status tone="error">{error}</Status>}
    </form>
  );
}

export function RetireButton({ path, label, confirm }: { path: string; label: string; confirm: string }) {
  const { run, error, pending } = useAction();
  return (
    <span className="inline-flex flex-col">
      <Button
        size="sm"
        variant="ghost"
        loading={pending}
        onClick={() => {
          if (window.confirm(confirm)) run(path, path.endsWith("/retire") ? "POST" : "DELETE");
        }}
      >
        {label}
      </Button>
      {error && <Status tone="error">{error}</Status>}
    </span>
  );
}
