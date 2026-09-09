import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";

import { AppError } from "@/core/errors";
import { db, schema, type Database } from "@/db/client";
import { hashPassword } from "@/server/auth/password";

/**
 * Membership: the first person to arrive owns the instance, and everyone
 * after them needs a code from someone already inside.
 *
 * This is the whole model, and it was chosen because it needs no e-mail
 * sender. Grape's only channels are "manual" and "x"; adding SMTP so that an
 * invitation could be delivered would be a larger feature than accounts are.
 * A code handed over in person, or in whatever chat the two people already
 * share, closes registration just as effectively.
 *
 * Everything here takes an injectable `database` so it can be tested against a
 * real in-memory SQLite rather than a mock of the constraint that does the
 * actual work.
 */

/**
 * Long rather than complicated. Composition rules push people towards
 * predictable substitutions; length is the thing that actually costs an
 * attacker something, and this is typed once and then kept in a password
 * manager. The owner's password guards every service on the instance and the
 * button that spends money, so it is not the place to be accommodating.
 */
export const MIN_PASSWORD_LENGTH = 12;

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface NewAccount {
  email: string;
  displayName: string;
  password: string;
}

export type User = typeof schema.users.$inferSelect;

/**
 * A connection or an open transaction. Spelled out rather than cast, so the
 * helpers below can be called from inside `transaction()` without pretending
 * a transaction is a connection.
 */
type Queryable = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validate(input: NewAccount): { email: string; displayName: string } {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError("INVALID_INPUT", `Not an e-mail address: ${email}`, {
      hint: "メールアドレスの形式で入力してください。",
    });
  }

  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new AppError("INVALID_INPUT", "Display name is empty", {
      hint: "表示名を入力してください。",
    });
  }

  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError("INVALID_INPUT", "Password shorter than the minimum", {
      hint: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`,
    });
  }

  return { email, displayName };
}

/**
 * The unique index is what actually prevents two accounts sharing an address —
 * checking first and inserting after would leave a gap two simultaneous
 * registrations could both walk through. So the constraint is allowed to fire,
 * and its violation is translated here rather than at the HTTP boundary: the
 * driver reports it several `cause` levels down inside a "Failed query:"
 * wrapper, and unwrapping that is knowledge about this insert, not about
 * routing.
 */
function isDuplicateEmail(error: unknown): boolean {
  for (let cause: unknown = error, depth = 0; cause && depth < 5; depth++) {
    const message = String((cause as { message?: unknown }).message ?? "");
    if (/UNIQUE constraint failed: users.email/i.test(message)) return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}

async function insertUser(
  tx: Queryable,
  values: { email: string; displayName: string; passwordHash: string; role: "owner" | "member" },
): Promise<User> {
  try {
    const [user] = await tx.insert(schema.users).values(values).returning();
    return user;
  } catch (error) {
    if (isDuplicateEmail(error)) {
      throw new AppError("CONFLICT", "e-mail already registered", {
        hint: "そのメールアドレスはすでに登録されています。",
      });
    }
    throw error;
  }
}

export async function accountsExist(database: Queryable = db): Promise<boolean> {
  const [row] = await database
    .select({ count: sql<number>`count(*)` })
    .from(schema.users);
  return (row?.count ?? 0) > 0;
}

/**
 * Claims an instance that has no accounts yet.
 *
 * The adoption of pre-account rows happens in the same transaction as the
 * insert. Doing it in a migration was not possible: which account ends up
 * owning them is only known at the moment somebody registers, and a migration
 * would have had to invent a user row to point at. Doing it afterwards, in a
 * second statement, would leave a window where the owner exists and their own
 * data does not belong to them.
 */
export async function registerFirstUser(
  input: NewAccount,
  database: Database = db,
): Promise<User> {
  const { email, displayName } = validate(input);
  const passwordHash = await hashPassword(input.password);

  return database.transaction(async (tx) => {
    if (await accountsExist(tx)) {
      throw new AppError("CONFLICT", "Registration is closed: an account already exists", {
        hint: "このGrapeにはすでにアカウントがあります。招待リンクからご登録ください。",
      });
    }

    const user = await insertUser(tx, { email, displayName, passwordHash, role: "owner" });

    await adoptPreAccountRows(tx, user.id);
    return user;
  });
}

/**
 * Everything created before there were accounts belongs to whoever claims the
 * instance. Products carried the literal "local"; model calls carried no owner
 * at all because the column did not exist when they were made.
 *
 * Safe to run more than once and for more than one account: it only ever
 * matches rows nobody has claimed, so a second caller finds nothing left.
 */
export async function adoptPreAccountRows(tx: Queryable, userId: string): Promise<void> {
  await tx
    .update(schema.products)
    .set({ userId })
    .where(eq(schema.products.userId, schema.LOCAL_USER));

  await tx
    .update(schema.llmCalls)
    .set({ userId })
    .where(isNull(schema.llmCalls.userId));
}

// --- Invitations ------------------------------------------------------------

/** Crockford-style: no I, L, O or U, so a code read aloud or retyped survives. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateCode(): string {
  // 26 characters of a 32-symbol alphabet is 130 bits — beyond guessing, and
  // still short enough to send in a chat message.
  return Array.from(randomBytes(26), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

function hashCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export interface CreatedInvite {
  /** Exists only in the response that created it; the row keeps a hash. */
  code: string;
  expiresAt: Date;
}

export async function createInvite(
  invitedBy: string,
  database: Database = db,
  now: Date = new Date(),
): Promise<CreatedInvite> {
  const code = generateCode();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);

  await database.insert(schema.invites).values({ codeHash: hashCode(code), invitedBy, expiresAt });
  return { code, expiresAt };
}

/**
 * A single failure sentence covers unknown, expired and already-used codes.
 * Distinguishing them would tell someone probing codes which guesses were
 * real, and none of the three is separately actionable for the person holding
 * a code that does not work: they need a new one either way.
 */
export async function redeemInvite(
  code: string,
  input: NewAccount,
  database: Database = db,
  now: Date = new Date(),
): Promise<User> {
  const { email, displayName } = validate(input);
  const passwordHash = await hashPassword(input.password);
  const codeHash = hashCode(code);

  return database.transaction(async (tx) => {
    const invite = await tx.query.invites.findFirst({
      where: and(eq(schema.invites.codeHash, codeHash), isNull(schema.invites.usedAt)),
    });

    if (!invite || invite.expiresAt.getTime() <= now.getTime()) {
      throw new AppError("UNAUTHORIZED", "Invite is unknown, expired or already used", {
        hint: "この招待リンクは使えません。招待した人に新しいものを発行してもらってください。",
      });
    }

    const user = await insertUser(tx, { email, displayName, passwordHash, role: "member" });

    // Conditioned on still being unused, so two people submitting the same
    // code at once cannot both get past it — the second update matches no row.
    const marked = await tx
      .update(schema.invites)
      .set({ usedAt: now, usedBy: user.id })
      .where(and(eq(schema.invites.id, invite.id), isNull(schema.invites.usedAt)))
      .returning();

    if (marked.length === 0) {
      throw new AppError("UNAUTHORIZED", "Invite was redeemed concurrently", {
        hint: "この招待リンクは使えません。招待した人に新しいものを発行してもらってください。",
      });
    }

    return user;
  });
}
