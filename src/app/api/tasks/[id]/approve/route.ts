import { NextResponse } from "next/server";
import { z } from "zod";

import { approveAndExecute } from "@/core/action/execute";

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
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = ApproveInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const run = await approveAndExecute(id, parsed.data.artifactId);
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
