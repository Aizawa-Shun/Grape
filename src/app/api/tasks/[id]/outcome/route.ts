import { NextResponse } from "next/server";

import { evaluateOutcome } from "@/core/intelligence/outcomes";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/**
 * Scores a completed task against the funnel stage its diagnosis targeted —
 * see outcomes.ts. Deliberately not run automatically when a task finishes:
 * a fair before/after comparison needs a full window of data *after*
 * completion too, which by definition has not happened yet at that moment.
 */
export const POST = route(
  "outcome.evaluate",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const outcome = await evaluateOutcome(id);
    return NextResponse.json({ outcome }, { status: 201 });
  },
);
