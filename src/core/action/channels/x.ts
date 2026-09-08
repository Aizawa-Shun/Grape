import { createHmac, randomBytes } from "node:crypto";

import type { ActionChannel } from "../channel";
import { ChannelError } from "../channel";

/**
 * Posts to X (api.x.com) via OAuth 1.0a user-context auth.
 *
 * OAuth 1.0a rather than the OAuth 2.0 App-Only or Authorization Code flows:
 * Grape is single-user, posting to its own account, so there is no login flow
 * to build — the product owner generates a consumer key/secret and access
 * token/secret once from the X developer portal (see .env.example) and pastes
 * them in. No `oauth-1.0a` package is pulled in for this; the signing
 * algorithm is short enough (RFC 5849 section 3) that a dependency would cost
 * more than it saves — and getting it wrong fails silently from the caller's
 * side (X just returns a generic 401), so the pieces below are split out
 * specifically so x.test.ts can check the signature against a published
 * reference vector rather than only against itself.
 *
 * X removed the free API tier in Feb 2026: every post is metered, and a post
 * containing a link costs roughly 13x a bare one. That is why this is the one
 * channel execute.ts refuses to call outside an explicit approval and outside
 * dry-run — see GRAPE_ACTION_DRY_RUN in env.ts.
 */

const API_URL = "https://api.x.com/2/tweets";

/** X's own limit. Enforced here, not trusted from the generating model. */
export const X_POST_MAX_CHARS = 280;

const HAS_LINK = /https?:\/\//i;
const COST_WITH_LINK_USD = 0.2;
const COST_WITHOUT_LINK_USD = 0.015;

export interface XCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

/** RFC 3986 percent-encoding — stricter than encodeURIComponent, which leaves !*'() unescaped. */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** RFC 5849 §3.4.1: every parameter that participates in the signature, not just the oauth_* ones. */
export function buildSignatureBaseString(method: string, url: string, params: Record<string, string>): string {
  const paramString = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join("&");
  return [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join("&");
}

/** RFC 5849 §3.4.2. HMAC-SHA1 is the only method X's API accepts. */
export function signHmacSha1(baseString: string, consumerSecret: string, tokenSecret: string): string {
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac("sha1", signingKey).update(baseString).digest("base64");
}

/**
 * Builds the `Authorization: OAuth ...` header. `extraSignedParams` covers
 * form-encoded body or query parameters, which RFC 5849 requires in the
 * signature but which never appear in the header itself — the JSON body this
 * module actually sends has none, so production calls pass `{}`; tests use
 * this to reproduce a published reference vector that does have some.
 */
export function buildAuthHeader(
  method: string,
  url: string,
  credentials: XCredentials,
  extraSignedParams: Record<string, string> = {},
  overrides: { nonce?: string; timestamp?: string } = {},
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.consumerKey,
    oauth_nonce: overrides.nonce ?? randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: overrides.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };

  const baseString = buildSignatureBaseString(method, url, { ...extraSignedParams, ...oauthParams });
  const signature = signHmacSha1(baseString, credentials.consumerSecret, credentials.accessTokenSecret);

  const headerParams: Record<string, string> = { ...oauthParams, oauth_signature: signature };
  return (
    "OAuth " +
    Object.keys(headerParams)
      .sort()
      .map((key) => `${percentEncode(key)}="${percentEncode(headerParams[key])}"`)
      .join(", ")
  );
}

export function estimateXPostCostUsd(content: string): number {
  return HAS_LINK.test(content) ? COST_WITH_LINK_USD : COST_WITHOUT_LINK_USD;
}

interface TweetResponse {
  data?: { id: string; text: string };
  errors?: { message: string }[];
  detail?: string;
  title?: string;
}

export function createXChannel(credentials: XCredentials): ActionChannel {
  return {
    name: "x",
    estimateCostUsd: estimateXPostCostUsd,

    async execute(content: string) {
      if (content.length > X_POST_MAX_CHARS) {
        throw new ChannelError(
          `Post is ${content.length} characters, over X's ${X_POST_MAX_CHARS} limit`,
          "x",
        );
      }

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: buildAuthHeader("POST", API_URL, credentials),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: content }),
      });

      const body = (await response.json().catch(() => null)) as TweetResponse | null;

      if (!response.ok || !body?.data) {
        const message =
          body?.errors?.[0]?.message ?? body?.detail ?? body?.title ?? `HTTP ${response.status}`;
        throw new ChannelError(`X API rejected the post: ${message}`, "x", body);
      }

      return {
        externalUrl: `https://x.com/i/status/${body.data.id}`,
        response: body,
      };
    },
  };
}
