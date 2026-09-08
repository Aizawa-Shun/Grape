import { NextResponse } from "next/server";
import { z } from "zod";

import {
  OVERRIDABLE_KEYS,
  currentOverrides,
  loadSettings,
  publicSettings,
  saveSettings,
} from "@/core/settings";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/**
 * Only the keys core/settings allows are accepted, and the values themselves
 * are validated there by running the whole configuration through the env
 * schema — so a bad value is rejected before it becomes what the next request
 * runs on. An empty string means "use whatever .env says".
 */
const PatchSchema = z.object(
  Object.fromEntries(OVERRIDABLE_KEYS.map((key) => [key, z.string().optional()])) as {
    [K in (typeof OVERRIDABLE_KEYS)[number]]: z.ZodOptional<z.ZodString>;
  },
);

export const GET = route("settings.read", async () => {
  const settings = await loadSettings();
  // publicSettings, never the Env object: that one also holds the API keys,
  // the admin password and the X credentials.
  return NextResponse.json({ settings: publicSettings(settings), overrides: currentOverrides() });
});

export const PATCH = route("settings.save", async (request) => {
  const patch = PatchSchema.parse(await request.json().catch(() => null));
  const { settings, overrides } = await saveSettings(patch);
  return NextResponse.json({ settings: publicSettings(settings), overrides });
});
