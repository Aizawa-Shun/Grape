import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError } from "@/core/errors";
import { db, schema } from "@/db/client";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/**
 * Setting the key event is what turns on the Activate (and, transitively,
 * Retain) stage of the funnel — see core/data/funnel.ts. Nothing else on the
 * product needs editing through this route yet, so it only accepts this one
 * field rather than doubling as a general product-update endpoint.
 */
const PatchInputSchema = z.object({
  keyEventName: z.string().trim().min(1).max(200).nullable(),
});

export const PATCH = route(
  "products.patch",
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const input = PatchInputSchema.parse(await request.json().catch(() => null));

    const [updated] = await db
      .update(schema.products)
      .set({ keyEventName: input.keyEventName })
      .where(eq(schema.products.id, id))
      .returning();

    if (!updated) throw new AppError("NOT_FOUND", `No product ${id}`);

    return NextResponse.json({ product: updated });
  },
);
