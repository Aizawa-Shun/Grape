import { NextResponse } from "next/server";

import { BrandVoiceInputSchema, saveBrandVoice } from "@/core/growth/actions";
import { assertProductOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";
export const maxDuration = 120;

export const POST = route(
  "growth.brand_voice.learn",
  async (request: Request, { params }: { params: Promise<{ productId: string }> }) => {
    const { productId } = await params;
    await assertProductOwner(productId, requireUserId());
    const { samples } = BrandVoiceInputSchema.parse(await request.json().catch(() => null));
    const brandVoice = await saveBrandVoice(productId, samples);
    return NextResponse.json({ brandVoice });
  },
);
