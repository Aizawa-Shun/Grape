import { NextResponse } from "next/server";
import { z } from "zod";

import { ownedPost } from "@/core/growth/actions";
import { approvePost } from "@/core/growth/publish";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

const InputSchema = z.object({ text: z.string().trim().min(1).max(4000).optional() });

/**
 * A person's approval. What happens next — sent, recorded in practice mode,
 * or left for them to post by hand — is decided in core/growth/publish.ts,
 * behind the same policy gate the agent is held to.
 */
export const POST = route(
  "growth.post.approve",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await ownedPost(id, requireUserId());
    const { text } = InputSchema.parse((await request.json().catch(() => ({}))) ?? {});
    const post = await approvePost(id, { text });
    return NextResponse.json({ post });
  },
);
