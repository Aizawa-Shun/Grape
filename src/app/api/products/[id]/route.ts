import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db, schema } from "@/db/client";

export const runtime = "nodejs";

/**
 * Setting the key event is what turns on the Activate (and, transitively,
 * Retain) stage of the funnel — see core/data/funnel.ts. Nothing else on the
 * product needs editing through this route yet, so it only accepts this one
 * field rather than doubling as a general product-update endpoint.
 */
const PatchInputSchema = z.object({
  keyEventName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .nullable(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = PatchInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const [updated] = await db
    .update(schema.products)
    .set({ keyEventName: parsed.data.keyEventName })
    .where(eq(schema.products.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }

  return NextResponse.json({ product: updated });
}
