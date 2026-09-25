"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Status } from "@/components/ui/status";

import { send } from "./request";

type Focus = "full" | "research" | "opportunities" | "content" | "learn";

/** Starts a run now instead of waiting for tomorrow's schedule. */
export function RunButton({
  productId,
  focus,
  label,
  variant = "secondary",
}: {
  productId: string;
  focus: Focus;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant={variant}
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await send(`/api/growth/${productId}/runs`, "POST", { kind: "manual", focus });
            if (!result.ok) return setError(result.error);
            router.push(`/products/${productId}/growth`);
            router.refresh();
          })
        }
      >
        {label}
      </Button>
      {error && <Status tone="error">{error}</Status>}
    </div>
  );
}
