import { NextResponse } from "next/server";
import { z } from "zod";

import { ownedPost } from "@/core/growth/actions";
import { markPublished } from "@/core/growth/publish";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

const InputSchema = z.object({ url: z.union([z.url().max(2000), z.literal("")]).optional() });

/** "I posted it myself" — through X's composer, or on the forum a reply belongs to. */
export const POST = route(
  "growth.post.published",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await ownedPost(id, requireUserId());
    const { url } = InputSchema.parse((await request.json().catch(() => ({}))) ?? {});
    const post = await markPublished(id, url || null);
    return NextResponse.json({ post });
  },
);
