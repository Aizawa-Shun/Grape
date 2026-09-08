import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { saveEditedContext } from "@/core/context/edit";
import { db, schema } from "@/db/client";

export const runtime = "nodejs";

/** Every version, newest first — the edit UI needs history, not just the latest. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const versions = await db.query.productContexts.findMany({
    where: eq(schema.productContexts.productId, id),
    orderBy: (contexts, { desc }) => [desc(contexts.version)],
  });
  return NextResponse.json({ versions });
}

const EditInputSchema = z.object({
  what: z.string().min(1),
  who: z.string().min(1),
  why: z.string().min(1),
  how: z.string().min(1),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = EditInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  try {
    const result = await saveEditedContext(id, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 404 },
    );
  }
}
