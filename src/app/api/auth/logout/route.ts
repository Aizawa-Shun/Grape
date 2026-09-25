import { NextResponse } from "next/server";

import { verifySessionCookie } from "@/server/auth/current-user";
import { SESSION_COOKIE } from "@/server/session";

export const runtime = "nodejs";

/**
 * Clears this browser's cookie and revokes the account's sessions, so a copy
 * of the cookie held anywhere else stops working too — current-user.ts
 * verifies with checkRevoked for exactly that.
 */
export async function POST(request: Request) {
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  const uid = await verifySessionCookie(cookie ? decodeURIComponent(cookie) : undefined);
  if (uid) {
    const { firebaseAuth } = await import("@/db/firebase");
    await firebaseAuth()
      .revokeRefreshTokens(uid)
      .catch(() => undefined);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
