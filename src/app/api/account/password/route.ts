import { NextResponse } from "next/server";
import { z } from "zod";

import { changePassword } from "@/core/auth/users";
import { requireUserId } from "@/server/auth/current-user";
import { route } from "@/server/http/route";
import { clientAddress, takeToken } from "@/server/rate-limit";

export const runtime = "nodejs";

/**
 * The same shape as the login limit, for the same reason. A session that has
 * been borrowed rather than stolen — an unlocked laptop, a shared browser —
 * is exactly the case where someone would sit and guess the current password
 * to make their access permanent. Verified-then-rejected is still an attempt.
 */
const ATTEMPTS = { capacity: 5, refillPerSec: 1 / 60 };

const BodySchema = z.object({
  currentPassword: z.string().max(1000),
  newPassword: z.string().max(1000),
});

export const PUT = route("account.password", async (request) => {
  const attempt = takeToken(`password:${clientAddress(request)}`, ATTEMPTS);
  if (!attempt.ok) {
    return NextResponse.json(
      {
        error: "試行回数が多すぎます。しばらく待ってから、もう一度お試しください。",
        code: "RATE_LIMITED",
      },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSec) } },
    );
  }

  const userId = requireUserId();
  const { currentPassword, newPassword } = BodySchema.parse(await request.json().catch(() => null));

  await changePassword(userId, currentPassword, newPassword);

  // The session is not reissued. It is signed with an instance-wide key and
  // names the account, not the password, so nothing about it went stale — and
  // signing the person out of the tab they are typing in would read as the
  // change having failed.
  return NextResponse.json({ ok: true });
});
