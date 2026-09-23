import { NextResponse } from "next/server";
import { z } from "zod";

import { setLlmApiKey } from "@/core/auth/users";
import { LLM_PROVIDER_NAMES } from "@/env";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/**
 * Always the caller's own account, same reasoning as PATCH /api/account: no
 * id in the body, so no id to tamper with. `apiKey: null` (or an empty
 * string — the client always sends one or the other) clears the key rather
 * than storing one, which is the "delete" affordance on /account.
 */
const PatchSchema = z.object({
  provider: z.enum(LLM_PROVIDER_NAMES),
  apiKey: z.string().nullable(),
});

export const PATCH = route("account.llm_key.save", async (request) => {
  const userId = requireUserId();
  const input = PatchSchema.parse(await request.json().catch(() => null));

  await setLlmApiKey(userId, input.provider, input.apiKey);
  return NextResponse.json({ ok: true });
});
