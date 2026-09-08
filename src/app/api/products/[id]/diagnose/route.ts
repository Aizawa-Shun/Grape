import { NextResponse } from "next/server";

import { diagnoseProduct } from "@/core/intelligence/diagnose";
import { recommendTasks } from "@/core/intelligence/recommend";

export const runtime = "nodejs";

/**
 * Runs the whole ③→④ hop in one request: diagnose (funnel or audit,
 * depending on traffic) then recommend (this week's tasks against that
 * diagnosis). Both are LLM calls with the diagnose effort tier set to "high"
 * (see EFFORT_BY_KIND) — slow on a local model, same tradeoff already made
 * for POST /api/products — so this stays synchronous rather than adding a
 * job queue for the MVP.
 *
 * Not run automatically on page load: an LLM call has a real cost (dollars on
 * Anthropic, minutes on a CPU-only local model), and re-running it every time
 * someone looks at the dashboard would silently multiply that. The dashboard
 * shows whatever the *last* diagnosis said; this route is what advances it.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const diagnosis = await diagnoseProduct(id);
    const tasks = await recommendTasks(diagnosis);
    return NextResponse.json({ diagnosis, tasks }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
