import { NextResponse } from "next/server";
import { z } from "zod";

import { generateArtifact } from "@/core/action/generate";
import { assertTaskOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { ARTIFACT_KINDS } from "@/db/schema";
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
/**
 * The body is optional: no body (or no `kind`) means the channel's default,
 * which is all this endpoint used to do. Whether a kind is allowed for the
 * task's channel is generate.ts's decision, not this schema's.
 */
const GenerateInputSchema = z.object({ kind: z.enum(ARTIFACT_KINDS).optional() });

export const POST = route(
  "artifact.generate",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    // A task reaches its owner through its product, which is the only place
    // tenancy is recorded.
    await assertTaskOwner(id, requireUserId());

    // An empty body (the button before kinds existed) is not JSON; treat it as {}.
    const input = GenerateInputSchema.parse(await request.json().catch(() => ({})));
    const artifact = await generateArtifact(id, { kind: input.kind });
    return NextResponse.json({ artifact }, { status: 201 });
  },
);
