import { NextResponse } from "next/server";
import { z } from "zod";

import { startProductSetup } from "@/core/product/register";
import { db } from "@/db/client";
import { by } from "@/db/sort";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

const RegisterInputSchema = z.object({
  url: z.string().min(1, "url is required"),
  name: z.string().optional(),
});

export const GET = route("products.list", async () => {
  const products = (await db.products.find({ where: [["userId", "==", requireUserId()]] })).sort(
    by((product) => product.createdAt, "desc"),
  );
  return NextResponse.json({ products });
});

/**
 * Answers as soon as the row exists, with the product pending.
 *
 * Reading the site is not started here. It runs in a request of its own,
 * POST /api/products/[id]/setup, which the review screen the browser is sent
 * to next calls as soon as it sees the pending product — because on App
 * Hosting (Cloud Run) CPU is only promised while a request is in flight, and
 * work left running after this response could stall. See claimProductSetup.
 *
 * 202, not 201: the product exists, and what was asked for is still to happen.
 */
export const POST = route("products.create", async (request) => {
  const input = RegisterInputSchema.parse(await request.json().catch(() => null));
  const started = await startProductSetup({ ...input, userId: requireUserId() });
  return NextResponse.json(started, { status: 202 });
});
