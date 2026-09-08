import { NextResponse } from "next/server";

import { evaluateOutcome } from "@/core/intelligence/outcomes";

export const runtime = "nodejs";

/**
 * Scores a completed task against the funnel stage its diagnosis targeted —
 * see outcomes.ts. Deliberately not run automatically when a task finishes:
 * a fair before/after comparison needs a full window of data *after*
 * completion too, which by definition has not happened yet at that moment.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const outcome = await evaluateOutcome(id);
    return NextResponse.json({ outcome }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
