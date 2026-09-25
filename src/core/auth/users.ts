import { createHash, randomBytes } from "node:crypto";

import { MIN_PASSWORD_LENGTH } from "@/core/auth/policy";
import { AppError } from "@/core/errors";
import { db, type Database } from "@/db/client";
import type { LLMProviderName } from "@/env";
import type { Invite, User } from "@/db/schema";
import { by } from "@/db/sort";
import type { CollectionSet } from "@/db/store/types";
import { decryptSecret, encryptSecret } from "@/server/secret-box";

/**
 * Membership: the first person to arrive owns the instance, and everyone
 * after them needs a code from someone already inside.
 *
 * Firebase Authentication owns the credential — the password, the Google
 * link, the reset e-mail — and anyone can create a Firebase account for this
 * project from a browser; there is no stopping that at the Firebase end.
 * What this module decides is whether such an account is let *into Grape*:
 * `enrollAccount` runs when someone signs in for the first time, and it is the
 * only thing that creates a `users` document. No document, no session (see
 * api/auth/session/route.ts).
 *
 * The rule is unchanged from when Grape kept its own passwords. It was chosen
 * because it needs no e-mail sender: a code handed over in person, or in
 * whatever chat the two people already share, closes registration just as
 * effectively.
 *
 * Everything here takes an injectable `database` so it can be tested against
 * the in-memory store.
 */

export { MIN_PASSWORD_LENGTH };
export type { User };

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What Firebase has vouched for about the person signing in. */
export interface FirebaseIdentity {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export async function accountsExist(database: Database = db): Promise<boolean> {
  return (await database.users.find({ limit: 1 })).length > 0;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

const INVITE_INVALID = {
  hint: "この招待リンクは使えません。招待した人に新しいものを発行してもらってください。",
} as const;

/**
 * Lets a Firebase account into Grape, or refuses it.
 *
 * Three outcomes, tried in order, all inside one transaction so that two
 * people signing in to a fresh instance at the same moment cannot both
 * become the owner, and two people cannot redeem one code:
 *
 *  1. This uid already has a document: it is a returning member. Its
 *     `lastLoginAt` moves; nothing else changes.
 *  2. There are no documents at all: this is the first person to arrive,
 *     and becomes the owner.
 *  3. Otherwise a valid, unused, unexpired invite code is required, and is
 *     spent.
 *
 * A single refusal message covers an unknown, expired and already-used code,
 * for the reason InviteState below gives.
 */
export async function enrollAccount(
  identity: FirebaseIdentity,
  inviteCode: string | undefined,
  database: Database = db,
  now: Date = new Date(),
): Promise<{ user: User; created: boolean }> {
  const email = (identity.email ?? "").trim().toLowerCase();
  const displayName = identity.displayName?.trim() || email.split("@")[0] || "メンバー";

  return database.runTransaction(async (tx) => {
    // Every read first — Firestore's rule for transactions.
    const existing = await tx.users.get(identity.uid);
    const anyone = existing ? [] : await tx.users.find({ limit: 1 });
    const invite =
      existing || anyone.length === 0 || !inviteCode
        ? null
        : await findOpenInvite(tx, inviteCode, now);

    if (existing) {
      await tx.users.update(identity.uid, { lastLoginAt: now });
      return { user: { ...existing, lastLoginAt: now }, created: false };
    }

    if (anyone.length === 0) {
      const user = await tx.users.set(identity.uid, {
        email,
        displayName,
        role: "owner",
        lastLoginAt: now,
        createdAt: now,
      });
      return { user, created: true };
    }

    if (!inviteCode) {
      throw new AppError("UNAUTHORIZED", "No invite for a new account", {
        hint: "このGrapeへの参加には招待リンクが必要です。オーナーに発行してもらってください。",
      });
    }
    if (!invite) {
      throw new AppError("UNAUTHORIZED", "Invite is unknown, expired or already used", INVITE_INVALID);
    }

    const user = await tx.users.set(identity.uid, {
      email,
      displayName,
      role: "member",
      lastLoginAt: now,
      createdAt: now,
    });
    await tx.invites.update(invite.id, { usedAt: now, usedBy: identity.uid });
    return { user, created: true };
  });
}

async function findOpenInvite(tx: CollectionSet, code: string, now: Date): Promise<Invite | null> {
  const invite = await tx.invites.first({ where: [["codeHash", "==", hashCode(code)]] });
  if (!invite || invite.usedAt !== null || invite.expiresAt.getTime() <= now.getTime()) return null;
  return invite;
}

// --- Account maintenance ----------------------------------------------------

/**
 * The display name, which is Grape's to keep. The e-mail address and the
 * password belong to Firebase and change there (see account-form.tsx).
 */
export async function updateProfile(
  userId: string,
  input: { displayName: string },
  database: Database = db,
): Promise<User> {
  const displayName = input.displayName.trim();
  if (!displayName) {
    throw new AppError("INVALID_INPUT", "Display name is empty", { hint: "表示名を入力してください。" });
  }

  const updated = await database.users.update(userId, { displayName });
  if (!updated) throw new AppError("NOT_FOUND", `No such account: ${userId}`);
  return updated;
}

// --- Invitations ------------------------------------------------------------

/** Crockford-style: no I, L, O or U, so a code read aloud or retyped survives. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function generateCode(): string {
  // 26 characters of a 32-symbol alphabet is 130 bits — beyond guessing, and
  // still short enough to send in a chat message.
  return Array.from(randomBytes(26), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export interface CreatedInvite {
  /** Exists only in the response that created it; the document keeps a hash. */
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

  await database.invites.insert({ codeHash: hashCode(code), invitedBy, expiresAt, createdAt: now });
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
 * What has been issued, never what was issued: the code is not stored — only
 * its hash — so this list cannot show it again. Expiry is computed rather
 * than stored, so a document does not need a sweep to stop counting as usable.
 */
export async function listInvites(
  database: Database = db,
  now: Date = new Date(),
): Promise<InviteSummary[]> {
  const rows = (await database.invites.find()).sort(by((invite) => invite.createdAt, "desc"));

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    state: row.usedAt ? "used" : row.expiresAt.getTime() <= now.getTime() ? "expired" : "open",
  }));
}

// --- LLM credentials ---------------------------------------------------------

/**
 * Each account's own key, not a shared instance secret. `LLM_PROVIDER` in the
 * environment / /settings says which service Grape talks to; this is the
 * credential for whichever account is actually asking, encrypted at rest
 * (server/secret-box.ts) because — unlike a password — it has to come back
 * out whole to be sent to the model on the account's behalf.
 *
 * `null` clears the key rather than storing an empty string.
 */
export async function setLlmApiKey(
  userId: string,
  provider: LLMProviderName,
  apiKey: string | null,
  database: Database = db,
): Promise<void> {
  const trimmed = apiKey?.trim();
  const encrypted = trimmed ? encryptSecret(trimmed) : null;

  const updated = await database.users.update(
    userId,
    provider === "anthropic" ? { anthropicApiKey: encrypted } : { openaiApiKey: encrypted },
  );
  if (!updated) throw new AppError("NOT_FOUND", `No such account: ${userId}`);
}

/**
 * The decrypted key, for the one caller allowed to see it in full —
 * `getProvider()` (core/llm/index.ts), right before it is handed to the
 * model. The account screen reads `hasLlmApiKeys` instead, so a page render
 * never touches decryption.
 */
export async function getLlmApiKey(
  userId: string,
  provider: LLMProviderName,
  database: Database = db,
): Promise<string | undefined> {
  const user = await database.users.get(userId);
  const encrypted = provider === "anthropic" ? user?.anthropicApiKey : user?.openaiApiKey;
  return encrypted ? decryptSecret(encrypted) : undefined;
}

export interface LlmKeyStatus {
  anthropic: boolean;
  "openai-compat": boolean;
}

export async function hasLlmApiKeys(userId: string, database: Database = db): Promise<LlmKeyStatus> {
  const user = await database.users.get(userId);
  return {
    anthropic: Boolean(user?.anthropicApiKey),
    "openai-compat": Boolean(user?.openaiApiKey),
  };
}
