import { NextResponse } from "next/server";

import { generateArtifact } from "@/core/action/generate";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/**
 * Generates a fresh artifact for a task — the LLM call in the Action layer
 * (see EFFORT_BY_KIND: "generate" is medium effort, so this is faster than
 * diagnose but still an LLM round-trip). Called again to regenerate; each
 * call inserts a new artifacts row rather than editing one in place, same
 * reasoning as Product Context versioning: a discarded draft should not
 * silently disappear from the record.
 */
export const POST = route(
  "artifact.generate",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const artifact = await generateArtifact(id);
    return NextResponse.json({ artifact }, { status: 201 });
  },
);
