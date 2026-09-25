import { NextResponse } from "next/server";
import { z } from "zod";

import { enrollAccount } from "@/core/auth/users";
import { AppError, toAppError } from "@/core/errors";
import { firebaseAuth } from "@/db/firebase";
import { describeForUser, statusOf } from "@/server/http/errors";
import { log } from "@/server/log";
import { clientAddress, takeToken } from "@/server/rate-limit";
import { SESSION_COOKIE, SESSION_TTL_SEC, cookieOptions } from "@/server/session";

export const runtime = "nodejs";

const SessionInputSchema = z.object({
  idToken: z.string().min(1),
  /** Only needed the first time someone who is not the first account signs in. */
  inviteCode: z.string().trim().min(1).max(200).optional(),
});

/** Guesses at invite codes are what this limits; a real sign-in needs one call. */
const ATTEMPTS = { capacity: 10, refillPerSec: 1 / 30 };

/**
 * A Firebase account becomes a Grape session here, and nowhere else.
 *
 * The browser has already signed in with Firebase (email/password or Google)
 * and sends the ID token it got. This verifies it, lets the account into
 * Grape or refuses it (core/auth/users.ts's enrollAccount — owner, invite,
 * or returning member), and only then exchanges the token for a session
 * cookie. So a session cookie existing means the account was let in.
 *
 * A refused *new* Firebase account is deleted again, so a stranger who tries
 * to sign up without an invite does not leave an account behind in the
 * project's Authentication list. Only one created in the last few minutes:
 * an older account with no Grape document is somebody else's business.
 *
 * Not wrapped in route(): it has no session to verify yet, and it sets one.
 */
export async function POST(request: Request) {
  const attempt = takeToken(`session:${clientAddress(request)}`, ATTEMPTS);
  if (!attempt.ok) {
    return NextResponse.json(
      { error: "試行回数が多すぎます。しばらく待ってから、もう一度お試しください。", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSec) } },
    );
  }

  let uid: string | undefined;
  try {
    const input = SessionInputSchema.parse(await request.json().catch(() => null));
    const auth = firebaseAuth();

    const decoded = await auth.verifyIdToken(input.idToken).catch((error: unknown) => {
      throw new AppError("UNAUTHORIZED", "ID token did not verify", { cause: error });
    });
    uid = decoded.uid;

    // A Google account's e-mail is verified by Google; a password account's
    // is not, and does not need to be — the invite is what vouches for it.
    const { user } = await enrollAccount(
      { uid: decoded.uid, email: decoded.email ?? null, displayName: (decoded.name as string) ?? null },
      input.inviteCode,
    );

    const sessionCookie = await auth.createSessionCookie(input.idToken, {
      expiresIn: SESSION_TTL_SEC * 1000,
    });

    const response = NextResponse.json({ ok: true, role: user.role });
    response.cookies.set(SESSION_COOKIE, sessionCookie, cookieOptions(request));
    return response;
  } catch (error) {
    const shown = toAppError(error);
    if (shown.code === "UNAUTHORIZED" && uid) await discardIfJustCreated(uid);
    if (shown.code === "INTERNAL") log.error("auth.session_failed", { error: String(error) });
    return NextResponse.json(
      { error: describeForUser(shown), code: shown.code },
      { status: statusOf(shown) },
    );
  }
}

const RECENT_MS = 10 * 60 * 1000;

async function discardIfJustCreated(uid: string): Promise<void> {
  try {
    const auth = firebaseAuth();
    const record = await auth.getUser(uid);
    const created = Date.parse(record.metadata.creationTime);
    if (Date.now() - created < RECENT_MS) await auth.deleteUser(uid);
  } catch {
    // Best effort: the account is refused either way.
  }
}
