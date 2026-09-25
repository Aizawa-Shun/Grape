import { NextResponse } from "next/server";
import { z } from "zod";

import { RUN_FOCUSES, startGrowthRun, type RunFocus } from "@/core/growth/agent";
import { assertProductOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

const InputSchema = z.object({
  kind: z.enum(["initial", "manual"]).default("manual"),
  focus: z.enum(Object.keys(RUN_FOCUSES) as [RunFocus, ...RunFocus[]]).optional(),
});

/**
 * Starts a growth run and answers at once — the steps run one per request
 * from the progress screen (runs/[runId]/advance), never after this response
 * (see core/growth/runs.ts for why). A run already going is returned instead.
 */
export const POST = route(
  "growth.run.start",
  async (request: Request, { params }: { params: Promise<{ productId: string }> }) => {
    const { productId } = await params;
    const userId = requireUserId();
    await assertProductOwner(productId, userId);
    const input = InputSchema.parse((await request.json().catch(() => ({}))) ?? {});
    const { run, created } = await startGrowthRun(productId, userId, input.kind, undefined, input.focus);
    return NextResponse.json({ run, created }, { status: created ? 201 : 200 });
  },
);
