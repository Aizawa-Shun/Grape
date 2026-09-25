import { NextResponse } from "next/server";

import { draftPostFromOpportunity, ownedOpportunity } from "@/core/growth/actions";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Turns a conversation into a post draft rather than a reply. */
export const POST = route(
  "growth.opportunity.post",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const opportunity = await ownedOpportunity(id, requireUserId());
    const post = await draftPostFromOpportunity(opportunity);
    return NextResponse.json({ post }, { status: 201 });
  },
);
