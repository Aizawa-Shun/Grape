import { NextResponse } from "next/server";

import { retireLearning } from "@/core/growth/actions";
import { assertProductOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/** A learning that no longer holds: kept in history, no longer read by the strategy. */
export const DELETE = route(
  "growth.learning.retire",
  async (_request: Request, { params }: { params: Promise<{ productId: string; learningId: string }> }) => {
    const { productId, learningId } = await params;
    await assertProductOwner(productId, requireUserId());
    await retireLearning(productId, learningId);
    return NextResponse.json({ ok: true });
  },
);
