import { NextResponse } from "next/server";

import { AnswerSchema, answerKnowledgeQuestion } from "@/core/growth/actions";
import { assertProductOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/** The owner answers one of Grape's open questions; the answer becomes a known fact. */
export const POST = route(
  "growth.question.answer",
  async (request: Request, { params }: { params: Promise<{ productId: string }> }) => {
    const { productId } = await params;
    await assertProductOwner(productId, requireUserId());
    const knowledge = await answerKnowledgeQuestion(productId, AnswerSchema.parse(await request.json().catch(() => null)));
    return NextResponse.json({ knowledge });
  },
);
