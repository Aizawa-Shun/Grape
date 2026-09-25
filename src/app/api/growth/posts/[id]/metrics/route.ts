import { NextResponse } from "next/server";

import { ManualMetricsSchema, ownedPost, saveManualMetrics } from "@/core/growth/actions";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/** Results read off X's own analytics by hand, for accounts without API read access. */
export const PUT = route(
  "growth.post.metrics",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const post = await ownedPost(id, requireUserId());
    const updated = await saveManualMetrics(post, ManualMetricsSchema.parse(await request.json().catch(() => null)));
    return NextResponse.json({ post: updated });
  },
);
