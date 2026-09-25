import { headers } from "next/headers";

import { currentOverrides, currentSettings } from "@/core/settings";

/**
 * The origin the tracking snippet should post to.
 *
 * INGEST_BASE_URL wins whenever someone set it — in the environment or from
 * /settings — because a custom domain is exactly the case where the request's
 * own host may not be the one visitors' browsers should use. Left unset, it
 * used to default to http://localhost:3000, which is right on a developer's
 * machine and silently wrong on a deployment: the snippet gets pasted onto a
 * real site, posts to localhost from a stranger's browser, and no event ever
 * arrives. So unset now means "wherever this page was served from", read off
 * the request App Hosting forwarded — correct on the first deploy with
 * nothing to fill in.
 */
export async function publicIngestOrigin(): Promise<string> {
  const configured = process.env.INGEST_BASE_URL || currentOverrides().INGEST_BASE_URL;
  if (configured) return currentSettings().INGEST_BASE_URL;

  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host");
  if (!host) return currentSettings().INGEST_BASE_URL;

  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = incoming.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}`;
}
