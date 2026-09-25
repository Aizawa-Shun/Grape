import { NextResponse } from "next/server";
import { z } from "zod";

import { contextVersions, saveEditedContext } from "@/core/context/edit";
import { assertProductOwner } from "@/core/product/ownership";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/** Every version, newest first — the edit UI needs history, not just the latest. */
export const GET = route(
  "context.list",
  async (_request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await assertProductOwner(id, requireUserId());

    const versions = await contextVersions(id);
    return NextResponse.json({ versions });
  },
);

const EditInputSchema = z.object({
  what: z.string().min(1),
  who: z.string().min(1),
  why: z.string().min(1),
  how: z.string().min(1),
});

export const PUT = route(
  "context.save",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    await assertProductOwner(id, requireUserId());

    const input = EditInputSchema.parse(await request.json().catch(() => null));
    const result = await saveEditedContext(id, input);
    return NextResponse.json(result, { status: 201 });
  },
);
