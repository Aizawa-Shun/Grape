import { NextResponse } from "next/server";

import { recordAction } from "@/core/growth/activity";
import { KnowledgeEditSchema, requireKnowledge, saveKnowledgeEdit } from "@/core/growth/knowledge";
import { assertProductOwner } from "@/core/product/ownership";
import { db } from "@/db/client";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/** A person's correction of what the AI understood. Every later agent reads it. */
export const PUT = route(
  "growth.knowledge.save",
  async (request: Request, { params }: { params: Promise<{ productId: string }> }) => {
    const { productId } = await params;
    await assertProductOwner(productId, requireUserId());
    const knowledge = await saveKnowledgeEdit(productId, KnowledgeEditSchema.parse(await request.json().catch(() => null)));
    await recordAction({ productId, kind: "knowledge.edited", summary: "プロダクトの理解をあなたが修正しました" });
    return NextResponse.json({ knowledge });
  },
);

/** Drops the "confirmed by a person" mark, so the next run may re-analyse. */
export const DELETE = route(
  "growth.knowledge.unlock",
  async (_request: Request, { params }: { params: Promise<{ productId: string }> }) => {
    const { productId } = await params;
    await assertProductOwner(productId, requireUserId());
    await requireKnowledge(productId);
    await db.productKnowledge.update(productId, { editedByHuman: false });
    return NextResponse.json({ ok: true });
  },
);
