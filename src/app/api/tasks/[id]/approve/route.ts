import { NextResponse } from "next/server";
import { z } from "zod";

import { approveAndExecute } from "@/core/action/execute";
import { assertTaskOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

const ApproveInputSchema = z.object({
  artifactId: z.string().min(1),
});

/**
 * The approval gate itself (see execute.ts). This is the only route in the
 * app that can cause a real, billed, public post — everything before it
 * (generate, diagnose, recommend) only reads and reasons. GRAPE_ACTION_DRY_RUN
 * still applies inside approveAndExecute regardless of what this route does;
 * there is no separate "confirm you really mean it" step here because the
 * dry-run flag *is* that step, set deliberately in .env rather than clicked
 * through in a dialog that trains people to click it without reading it.
 */
export const POST = route(
  "task.approve",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    // The one route that can spend money and publish in public, so this is the
    // last place an ownership check may be missing.
    await assertTaskOwner(id, requireUserId());

    const input = ApproveInputSchema.parse(await request.json().catch(() => null));
    const run = await approveAndExecute(id, input.artifactId);
    return NextResponse.json({ run }, { status: 201 });
  },
);
