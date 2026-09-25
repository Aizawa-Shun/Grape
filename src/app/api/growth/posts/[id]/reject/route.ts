import { NextResponse } from "next/server";
import { z } from "zod";

import { ownedPost } from "@/core/growth/actions";
import { rejectPost } from "@/core/growth/publish";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

const InputSchema = z.object({ reason: z.string().trim().max(300).default("") });

export const POST = route(
  "growth.post.reject",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await ownedPost(id, requireUserId());
    const { reason } = InputSchema.parse((await request.json().catch(() => ({}))) ?? {});
    const post = await rejectPost(id, reason);
    return NextResponse.json({ post });
  },
);
