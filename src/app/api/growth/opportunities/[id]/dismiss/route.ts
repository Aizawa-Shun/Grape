import { NextResponse } from "next/server";

import { dismissOpportunity, ownedOpportunity } from "@/core/growth/actions";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

export const POST = route(
  "growth.opportunity.dismiss",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await dismissOpportunity(await ownedOpportunity(id, requireUserId()));
    return NextResponse.json({ ok: true });
  },
);
