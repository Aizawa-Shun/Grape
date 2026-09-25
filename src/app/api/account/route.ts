import { NextResponse } from "next/server";
import { z } from "zod";

import { updateProfile } from "@/core/auth/users";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/**
 * Always the caller's own account, taken from the session rather than from the
 * body. There is no id to pass, so there is no id to tamper with — the one
 * shape of this endpoint that cannot become a way to edit somebody else.
 */
const PatchSchema = z.object({
  displayName: z.string().max(200),
});

export const PATCH = route("account.update", async (request) => {
  const userId = requireUserId();
  const input = PatchSchema.parse(await request.json().catch(() => null));

  const user = await updateProfile(userId, input);
  return NextResponse.json({ displayName: user.displayName });
});
