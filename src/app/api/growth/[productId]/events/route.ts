import { NextResponse } from "next/server";

import { EventNamesSchema, saveEventNames } from "@/core/growth/actions";
import { assertProductOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/** Which tracked events mean "signed up" and "paid". Activation is the funnel's key event, set on /settings. */
export const PUT = route(
  "growth.events.save",
  async (request: Request, { params }: { params: Promise<{ productId: string }> }) => {
    const { productId } = await params;
    await assertProductOwner(productId, requireUserId());
    await saveEventNames(productId, EventNamesSchema.parse(await request.json().catch(() => null)));
    return NextResponse.json({ ok: true });
  },
);
