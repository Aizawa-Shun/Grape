import { NextResponse } from "next/server";

import { addOwnerLearning, OwnerLearningSchema } from "@/core/growth/actions";
import { assertProductOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/** Something the owner already knows about their market, added beside what experiments found. */
export const POST = route(
  "growth.learning.add",
  async (request: Request, { params }: { params: Promise<{ productId: string }> }) => {
    const { productId } = await params;
    await assertProductOwner(productId, requireUserId());
    const learning = await addOwnerLearning(productId, OwnerLearningSchema.parse(await request.json().catch(() => null)));
    return NextResponse.json({ learning }, { status: 201 });
  },
);
