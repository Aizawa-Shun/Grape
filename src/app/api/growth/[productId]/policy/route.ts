import { NextResponse } from "next/server";

import { recordAction } from "@/core/growth/activity";
import { PolicyInputSchema, savePolicy } from "@/core/growth/policy";
import { assertProductOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

export const PUT = route(
  "growth.policy.save",
  async (request: Request, { params }: { params: Promise<{ productId: string }> }) => {
    const { productId } = await params;
    await assertProductOwner(productId, requireUserId());
    const policy = await savePolicy(productId, PolicyInputSchema.parse(await request.json().catch(() => null)));
    await recordAction({ productId, kind: "policy.saved", summary: `承認モードと安全設定を更新しました（${policy.approvalMode}）` });
    return NextResponse.json({ policy });
  },
);
