import { NextResponse } from "next/server";

import { draftReply, ownedOpportunity } from "@/core/growth/actions";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = route(
  "growth.opportunity.reply",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const opportunity = await ownedOpportunity(id, requireUserId());
    const post = await draftReply(opportunity);
    return NextResponse.json({ post }, { status: 201 });
  },
);
