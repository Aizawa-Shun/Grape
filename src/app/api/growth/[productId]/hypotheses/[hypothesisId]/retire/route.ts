import { NextResponse } from "next/server";

import { retireHypothesis } from "@/core/growth/actions";
import { assertProductOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/** Stops testing a hypothesis. The next run designs another in its place. */
export const POST = route(
  "growth.hypothesis.retire",
  async (_request: Request, { params }: { params: Promise<{ productId: string; hypothesisId: string }> }) => {
    const { productId, hypothesisId } = await params;
    await assertProductOwner(productId, requireUserId());
    await retireHypothesis(productId, hypothesisId);
    return NextResponse.json({ ok: true });
  },
);
