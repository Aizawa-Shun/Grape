import { AppError } from "@/core/errors";
import { env } from "@/env";

/**
 * Talks to Google. Nothing here touches the database — that half (deciding
 * which account this identity is, or becomes) lives in core/auth/users.ts,
 * the same place every other way of arriving at an account lives.
 *
 * Authorization Code flow without a client library: Grape has no other OAuth
 * consumer to justify the dependency, and the whole exchange is two HTTP
 * calls. PKCE is not added on top of it — this is a confidential client
 * (the secret lives on the server, never in a browser), which is exactly the
 * case PKCE exists to cover for a client that cannot hold one.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export function googleSignInAvailable(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/**
 * `redirectUri` is passed in rather than built here because it depends on the
 * request that is asking — the same origin that will receive the callback,
 * derived from that request's own Host header (see the two route handlers).
 * Google rejects the exchange outright if this string does not exactly match
 * one of the URIs registered on the OAuth client, so it cannot be a constant
 * shared between a local checkout and the deployed instance.
 */
export function googleAuthorizationUrl(redirectUri: string, state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  // openid is what makes Google issue a `sub` at all; email/profile are the
  // only two fields registerFirstUser or redeemInvite need from an identity.
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  // Without this, a second sign-in after revoking access at myaccount.google.com
  // sails through silently — asking again is the more honest default for an
  // account-creation flow.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface GoogleIdentity {
  /** Google's own subject id — stable even across an e-mail address change. */
  googleId: string;
  email: string;
  displayName: string;
}

const GOOGLE_SIGN_IN_FAILED = {
  hint: "Googleでのログインに失敗しました。もう一度お試しください。",
} as const;

interface GoogleTokenResponse {
  access_token: string;
}

interface GoogleUserinfoResponse {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/**
 * The code Google's redirect handed back, turned into the identity behind it.
 *
 * Reads the userinfo endpoint with the access token rather than decoding the
 * id_token's JWT locally: verifying that JWT's signature would mean fetching
 * and caching Google's JWKS and checking algorithm, issuer and audience by
 * hand. Asking Google's own endpoint, over TLS, with the token Google itself
 * just issued, gets the same claims without re-implementing a JWT verifier for
 * one caller.
 */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
): Promise<GoogleIdentity> {
  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  }).catch((cause: unknown) => {
    throw new AppError("UNAUTHORIZED", "Could not reach Google's token endpoint", {
      ...GOOGLE_SIGN_IN_FAILED,
      cause,
    });
  });

  if (!tokenResponse.ok) {
    throw new AppError(
      "UNAUTHORIZED",
      `Google token exchange failed: ${tokenResponse.status} ${await tokenResponse.text()}`,
      GOOGLE_SIGN_IN_FAILED,
    );
  }

  const { access_token: accessToken } = (await tokenResponse.json()) as GoogleTokenResponse;

  const userinfoResponse = await fetch(USERINFO_ENDPOINT, {
    headers: { authorization: `Bearer ${accessToken}` },
  }).catch((cause: unknown) => {
    throw new AppError("UNAUTHORIZED", "Could not reach Google's userinfo endpoint", {
      ...GOOGLE_SIGN_IN_FAILED,
      cause,
    });
  });

  if (!userinfoResponse.ok) {
    throw new AppError(
      "UNAUTHORIZED",
      `Google userinfo request failed: ${userinfoResponse.status}`,
      GOOGLE_SIGN_IN_FAILED,
    );
  }

  const info = (await userinfoResponse.json()) as GoogleUserinfoResponse;

  // An unverified address is one Google itself will not vouch for — someone
  // could have typed it into their own Google profile without proving they
  // receive mail there. Trusting it would let that person claim an existing
  // Grape account by e-mail match (see signInWithGoogle) without ever proving
  // they hold the address.
  if (!info.email || !info.email_verified) {
    throw new AppError("UNAUTHORIZED", "Google account has no verified e-mail address", {
      hint: "確認済みのメールアドレスを持つGoogleアカウントでログインしてください。",
    });
  }

  return { googleId: info.sub, email: info.email, displayName: info.name?.trim() || info.email };
}
