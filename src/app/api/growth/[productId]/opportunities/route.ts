import { NextResponse } from "next/server";

import { addPastedOpportunity, PastedOpportunitySchema } from "@/core/growth/actions";
import { assertProductOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";
export const maxDuration = 120;

/** A conversation the person found and pasted in, scored like any other. */
export const POST = route(
  "growth.opportunity.paste",
  async (request: Request, { params }: { params: Promise<{ productId: string }> }) => {
    const { productId } = await params;
    await assertProductOwner(productId, requireUserId());
    const input = PastedOpportunitySchema.parse(await request.json().catch(() => null));
    const opportunity = await addPastedOpportunity(productId, input);
    return NextResponse.json({ opportunity }, { status: 201 });
  },
);
