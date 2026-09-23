import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";

import { MIN_PASSWORD_LENGTH } from "@/core/auth/policy";
import { AppError } from "@/core/errors";
import { db, schema, type Database } from "@/db/client";
import type { LLMProviderName } from "@/env";
import { NO_PASSWORD_LOGIN, hashPassword, verifyPassword } from "@/server/auth/password";
import { decryptSecret, encryptSecret } from "@/server/secret-box";

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

export { MIN_PASSWORD_LENGTH };

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface NewAccount {
  email: string;
  displayName: string;
  password: string;
}

/** What the account screen may change without proving anything. */
export interface ProfileEdit {
  email: string;
  displayName: string;
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

/**
 * Split out from `validate` so editing a profile and creating an account
 * enforce one rule each rather than two copies that can drift: a rename must
 * accept exactly the names registration would have.
 */
function validateIdentity(input: ProfileEdit): { email: string; displayName: string } {
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

  return { email, displayName };
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError("INVALID_INPUT", "Password shorter than the minimum", {
      hint: `パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`,
    });
  }
}

function validate(input: NewAccount): { email: string; displayName: string } {
  const identity = validateIdentity(input);
  validatePassword(input.password);
  return identity;
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
function isUniqueViolation(error: unknown, column: string): boolean {
  for (let cause: unknown = error, depth = 0; cause && depth < 5; depth++) {
    const message = String((cause as { message?: unknown }).message ?? "");
    if (new RegExp(`UNIQUE constraint failed: users.${column}`, "i").test(message)) return true;
    cause = (cause as { cause?: unknown }).cause;
  }
  return false;
}

function isDuplicateEmail(error: unknown): boolean {
  return isUniqueViolation(error, "email");
}

async function insertUser(
  tx: Queryable,
  values: {
    email: string;
    displayName: string;
    passwordHash: string;
    role: "owner" | "member";
    googleId?: string;
  },
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
    // Reachable only if the same Google account starts two sign-ins at once —
    // signInWithGoogle already looked for this googleId and found nothing, so
    // this is the other request winning the race, not a stale check.
    if (values.googleId && isUniqueViolation(error, "google_id")) {
      throw new AppError("CONFLICT", "Google account already linked", {
        hint: "このGoogleアカウントはすでに使われています。もう一度お試しください。",
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

// --- Account maintenance ----------------------------------------------------

/**
 * Rename, or move the account to a different address.
 *
 * No password is asked for. The session already proves who this is, and the
 * two fields it changes are not credentials — an attacker holding the session
 * can already read everything the account can see, so a re-prompt here would
 * buy nothing and only teach people to retype their password on request.
 * Changing the password itself is the operation that asks, below.
 */
export async function updateProfile(
  userId: string,
  input: ProfileEdit,
  database: Database = db,
): Promise<User> {
  const { email, displayName } = validateIdentity(input);

  try {
    const [updated] = await database
      .update(schema.users)
      .set({ email, displayName })
      .where(eq(schema.users.id, userId))
      .returning();

    if (!updated) throw new AppError("NOT_FOUND", `No such account: ${userId}`);
    return updated;
  } catch (error) {
    // The same unique index registration walks into, reached from the other
    // direction: moving onto an address someone else already holds.
    if (isDuplicateEmail(error)) {
      throw new AppError("CONFLICT", "e-mail already registered", {
        hint: "そのメールアドレスはすでに登録されています。",
      });
    }
    throw error;
  }
}

/**
 * The current password is required even though the session already proves
 * identity, because this is the operation that would let a borrowed session
 * become permanent access. Verifying it costs one scrypt derivation and closes
 * that.
 *
 * The failure says only that the current password is wrong. There is nothing
 * to hide about whether the account exists — the caller is signed in as it —
 * but a second, more specific message would only be a place for the wording to
 * drift away from what actually failed.
 */
export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  database: Database = db,
): Promise<void> {
  validatePassword(newPassword);

  const user = await database.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) throw new AppError("NOT_FOUND", `No such account: ${userId}`);

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new AppError("UNAUTHORIZED", "Current password does not verify", {
      hint: "いまのパスワードが違います。",
    });
  }

  await database
    .update(schema.users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(schema.users.id, userId));
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
export type InviteState = "open" | "used" | "expired";

export interface InviteSummary {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  state: InviteState;
}

/**
 * What has been issued, never what was issued.
 *
 * The code is not in the row — only its hash — so this list cannot show it
 * again, and the screen built on it has to say so. That is the honest shape:
 * an owner who has lost a code issues another one, which is cheap, rather than
 * Grape keeping a recoverable secret for the convenience.
 *
 * Expiry is computed rather than stored, so a row does not need a sweep to
 * stop counting as usable.
 */
export async function listInvites(
  database: Database = db,
  now: Date = new Date(),
): Promise<InviteSummary[]> {
  const rows = await database.query.invites.findMany({
    orderBy: (invites, { desc }) => [desc(invites.createdAt)],
  });

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    state: row.usedAt ? "used" : row.expiresAt.getTime() <= now.getTime() ? "expired" : "open",
  }));
}

const INVITE_INVALID = {
  hint: "この招待リンクは使えません。招待した人に新しいものを発行してもらってください。",
} as const;

/**
 * The half of redemption that only reads: finds a still-open invite, or
 * throws the one message that covers unknown, expired and already-used alike
 * (see InviteState above for why they are not told apart).
 *
 * Split out from `redeemInvite` so `signInWithGoogle` can share it — a code
 * that unlocks a password account must unlock a Google one on the same terms,
 * not a second, drifted copy of what "still open" means.
 */
export async function findOpenInvite(
  tx: Queryable,
  code: string,
  now: Date,
): Promise<typeof schema.invites.$inferSelect> {
  const invite = await tx.query.invites.findFirst({
    where: and(eq(schema.invites.codeHash, hashCode(code)), isNull(schema.invites.usedAt)),
  });

  if (!invite || invite.expiresAt.getTime() <= now.getTime()) {
    throw new AppError("UNAUTHORIZED", "Invite is unknown, expired or already used", INVITE_INVALID);
  }
  return invite;
}

/**
 * The half that writes, conditioned on the invite still being unused so two
 * people submitting the same code at once cannot both get past it — the
 * second update matches no row and throws.
 */
export async function consumeInvite(
  tx: Queryable,
  inviteId: string,
  userId: string,
  now: Date,
): Promise<void> {
  const marked = await tx
    .update(schema.invites)
    .set({ usedAt: now, usedBy: userId })
    .where(and(eq(schema.invites.id, inviteId), isNull(schema.invites.usedAt)))
    .returning();

  if (marked.length === 0) {
    throw new AppError("UNAUTHORIZED", "Invite was redeemed concurrently", INVITE_INVALID);
  }
}

export async function redeemInvite(
  code: string,
  input: NewAccount,
  database: Database = db,
  now: Date = new Date(),
): Promise<User> {
  const { email, displayName } = validate(input);
  const passwordHash = await hashPassword(input.password);

  return database.transaction(async (tx) => {
    const invite = await findOpenInvite(tx, code, now);
    const user = await insertUser(tx, { email, displayName, passwordHash, role: "member" });
    await consumeInvite(tx, invite.id, user.id, now);
    return user;
  });
}

// --- Google sign-in ----------------------------------------------------------

export interface GoogleIdentity {
  googleId: string;
  email: string;
  displayName: string;
}

/**
 * Arriving from Google reaches the same account rules password sign-in does —
 * one owner first, an invite for anyone after — through a different door.
 *
 * Three outcomes, tried in order:
 *
 *  1. This Google account has signed in before (`googleId` matches): return
 *     that row. The common case after the first time.
 *  2. It has not, but its e-mail matches a row created by password
 *     registration: link `googleId` onto it and return it. Google has just
 *     vouched for that address (see core/auth/google.ts's email_verified
 *     check), so this is the same address, not merely a similar one — and
 *     without linking, an owner who registered with a password could never
 *     use "Sign in with Google" for the account they already have.
 *  3. Neither matches: a new account, exactly like registerFirstUser or
 *     redeemInvite — the first ever gets ownership, everyone after needs the
 *     same invite code this identity was handed.
 *
 * `passwordHash` gets NO_PASSWORD_LOGIN in the third case: this row's identity
 * is Google's session, not a password Grape ever hashed, and a value no
 * scrypt output can equal keeps the password-reset script and the login route
 * from needing to know accounts can lack a password at all.
 */
export async function signInWithGoogle(
  identity: GoogleIdentity,
  inviteCode: string | undefined,
  database: Database = db,
  now: Date = new Date(),
): Promise<User> {
  const email = normalizeEmail(identity.email);
  const displayName = identity.displayName.trim() || email;

  return database.transaction(async (tx) => {
    const byGoogleId = await tx.query.users.findFirst({
      where: eq(schema.users.googleId, identity.googleId),
    });
    if (byGoogleId) return byGoogleId;

    const byEmail = await tx.query.users.findFirst({ where: eq(schema.users.email, email) });
    if (byEmail) {
      const [linked] = await tx
        .update(schema.users)
        .set({ googleId: identity.googleId })
        .where(eq(schema.users.id, byEmail.id))
        .returning();
      return linked;
    }

    if (!(await accountsExist(tx))) {
      const user = await insertUser(tx, {
        email,
        displayName,
        passwordHash: NO_PASSWORD_LOGIN,
        googleId: identity.googleId,
        role: "owner",
      });
      await adoptPreAccountRows(tx, user.id);
      return user;
    }

    if (!inviteCode) {
      throw new AppError(
        "UNAUTHORIZED",
        "No invite and no existing account for this Google identity",
        {
          hint: "このGrapeへの参加には招待リンクが必要です。オーナーに発行してもらってください。",
        },
      );
    }

    const invite = await findOpenInvite(tx, inviteCode, now);
    const user = await insertUser(tx, {
      email,
      displayName,
      passwordHash: NO_PASSWORD_LOGIN,
      googleId: identity.googleId,
      role: "member",
    });
    await consumeInvite(tx, invite.id, user.id, now);
    return user;
  });
}

// --- LLM credentials ---------------------------------------------------------

/**
 * Each account's own key, not a shared instance secret. `LLM_PROVIDER` in
 * .env / /settings still says which service Grape talks to; this is the
 * credential for whichever account is actually asking, encrypted at rest
 * (server/secret-box.ts) because — unlike a password — it has to come back
 * out whole to be sent to the model on the account's behalf.
 *
 * `null` clears the key rather than storing an empty string — the account
 * screen's "delete" is indistinguishable from "never set one" on read either
 * way, so there is no reason to keep a row that decrypts to "".
 */
export async function setLlmApiKey(
  userId: string,
  provider: LLMProviderName,
  apiKey: string | null,
  database: Database = db,
): Promise<void> {
  const trimmed = apiKey?.trim();
  const encrypted = trimmed ? encryptSecret(trimmed) : null;

  const [updated] = await database
    .update(schema.users)
    .set(provider === "anthropic" ? { anthropicApiKey: encrypted } : { openaiApiKey: encrypted })
    .where(eq(schema.users.id, userId))
    .returning();

  if (!updated) throw new AppError("NOT_FOUND", `No such account: ${userId}`);
}

/**
 * The decrypted key, for the one caller allowed to see it in full —
 * `getProvider()` (core/llm/index.ts), right before it is handed to the
 * model. Everything else that only needs to know *whether* a key exists
 * (the account screen) should read `hasLlmApiKeys` instead, so a page render
 * never touches decryption at all.
 */
export async function getLlmApiKey(
  userId: string,
  provider: LLMProviderName,
  database: Database = db,
): Promise<string | undefined> {
  const user = await database.query.users.findFirst({ where: eq(schema.users.id, userId) });
  const encrypted = provider === "anthropic" ? user?.anthropicApiKey : user?.openaiApiKey;
  return encrypted ? decryptSecret(encrypted) : undefined;
}

export interface LlmKeyStatus {
  anthropic: boolean;
  "openai-compat": boolean;
}

export async function hasLlmApiKeys(userId: string, database: Database = db): Promise<LlmKeyStatus> {
  const user = await database.query.users.findFirst({ where: eq(schema.users.id, userId) });
  return {
    anthropic: Boolean(user?.anthropicApiKey),
    "openai-compat": Boolean(user?.openaiApiKey),
  };
}
