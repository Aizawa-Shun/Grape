"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

import { send } from "./request";

/** Drops an idea before it is written. The next run plans another in its place. */
export function RejectIdea({ postId }: { postId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await send(`/api/growth/posts/${postId}/reject`, "POST", { reason: "ネタとして不要" });
          if (result.ok) router.refresh();
        })
      }
    >
      取り下げる
    </Button>
  );
}
