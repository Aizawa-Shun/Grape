import { NextResponse } from "next/server";

import { createInvite, listInvites } from "@/core/auth/users";
import { AppError } from "@/core/errors";
import { requireApiUser } from "@/server/auth/current-user";
import { route } from "@/server/http/route";

export const runtime = "nodejs";

/**
 * Owner-only. Not because members cannot be trusted, but because "who may
 * enlarge the set of people with access" is the one permission an instance
 * with a shared AI budget and a button that posts publicly needs to keep
 * narrow — and it is the only thing `users.role` is for.
 *
 * The code comes back in this response and nowhere else. Grape has no e-mail
 * sender, so delivery is the owner's to arrange; the row keeps only a hash.
 */
async function requireOwner() {
  const user = await requireApiUser();
  if (user.role !== "owner") {
    throw new AppError("UNAUTHORIZED", "Only the owner may invite", {
      hint: "招待を発行できるのはオーナーだけです。",
    });
  }
  return user;
}

export const POST = route("auth.invite", async () => {
  const user = await requireOwner();

  const invite = await createInvite(user.id);
  return NextResponse.json(invite, { status: 201 });
});

/**
 * What has been issued and what became of it — never the codes themselves,
 * which no longer exist anywhere by the time this can be called. Behind the
 * same owner check as issuing: who has been let in is the same question as who
 * may let someone in.
 */
export const GET = route("auth.invites", async () => {
  await requireOwner();

  return NextResponse.json({ invites: await listInvites() });
});
