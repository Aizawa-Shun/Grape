import { NextResponse } from "next/server";

import { GoalInputSchema, setGoal } from "@/core/growth/goals";
import { assertProductOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

export const PUT = route(
  "growth.goal.set",
  async (request: Request, { params }: { params: Promise<{ productId: string }> }) => {
    const { productId } = await params;
    await assertProductOwner(productId, requireUserId());
    const goal = await setGoal(productId, GoalInputSchema.parse(await request.json().catch(() => null)));
    return NextResponse.json({ goal });
  },
);
