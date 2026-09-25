import { NextResponse } from "next/server";

import { ownedRun } from "@/core/growth/actions";
import { advanceGrowthRun } from "@/core/growth/agent";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";
// One step: a few web searches and model calls can take a couple of minutes.
export const maxDuration = 300;

/**
 * Runs the next step of a growth run inside this request, if nobody else is
 * running one, and answers with the run as it stands. The progress screen
 * calls this in a loop until the run finishes; closing it simply pauses the
 * run until the next visit or the scheduled tick carries it on.
 */
export const POST = route(
  "growth.run.advance",
  async (_request: Request, { params }: { params: Promise<{ runId: string }> }) => {
    const { runId } = await params;
    await ownedRun(runId, requireUserId());
    const run = await advanceGrowthRun(runId);
    return NextResponse.json({ run });
  },
);
