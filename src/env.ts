import { z } from "zod";

/**
 * Central, validated configuration.
 *
 * Everything that decides *where* Grape talks to the outside world lives here,
 * so swapping an LLM provider or moving the ingest endpoint is a config change
 * rather than a code change. That swappability is the point of the Intelligence
 * layer being an abstraction (spec §7).
 */

export const LLM_PROVIDER_NAMES = ["anthropic", "openai-compat"] as const;
export type LLMProviderName = (typeof LLM_PROVIDER_NAMES)[number];

/**
 * `z.url()` alone is not enough: `new URL("localhost:1234")` succeeds, with
 * protocol "localhost:" — exactly the typo this is meant to catch.
 */
const httpUrl = (fallback: string) =>
  z
    .string()
    .refine(
      (value) => {
        try {
          const { protocol } = new URL(value);
          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "must be an http:// or https:// URL" },
    )
    .default(fallback);

const EnvSchema = z.object({
  // Trimmed: a platform's environment-variable editor pasting in a trailing
  // newline is a one-character difference from a valid token, and the only
  // symptom on the other end is Turso answering every query with a flat 401 —
  // nothing points back at whitespace. See db/connection.ts, which reads these
  // two the same way for the standalone scripts that bypass this schema.
  DATABASE_URL: z.string().trim().default("file:./grape.db"),
  // Only libsql:// and https:// remote databases need this — a local file:
  // URL has no server on the other end to authenticate to.
  DATABASE_AUTH_TOKEN: z.string().trim().optional(),

  // --- Intelligence layer -------------------------------------------------
  /**
   * Unset by default — AI is opt-in, not a thing a fresh checkout is quietly
   * running against. Picks *which* service and model Grape talks to; it says
   * nothing about credentials any more. Each account brings its own API key
   * from /account (see core/auth/users.ts's setLlmApiKey / getLlmApiKey), so a
   * provider being chosen here does not by itself mean any given user can
   * actually call it — `getProvider()` (core/llm/index.ts) is what checks
   * that, per request, for whoever is asking. Product understanding with
   * neither a provider selected nor a key on file falls back to the
   * rule-based reading of the page itself (core/context/extract.ts);
   * diagnosis, task recommendation and artifact generation simply refuse with
   * a clear error until both are in place (see LLM_NOT_CONFIGURED).
   */
  LLM_PROVIDER: z.enum(LLM_PROVIDER_NAMES).optional(),

  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),

  /**
   * Generous, because a slow or heavily-loaded endpoint legitimately needs a
   * minute to answer a long prompt. The point is not to be strict — it is that
   * without any limit a stalled request holds a Node handle indefinitely and
   * the page just spins.
   */
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /** Short on purpose: /api/health must answer even when the model is wedged. */
  LLM_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  /**
   * How many times to re-ask after unparseable output. One is deliberate:
   * a model that has already broken the grammar twice is unlikely to fix it on
   * a third try, and each attempt costs another full prompt evaluation.
   */
  LLM_MAX_REPAIRS: z.coerce.number().int().min(0).max(3).default(1),

  /**
   * Ceiling on estimated spend per calendar month, in USD, across every LLM
   * call.
   *
   * Deliberately small by default: this targets someone with no marketing
   * budget, not someone who has already sized their AI spend. Raising it is
   * one settings field; discovering it was unlimited after the fact is not
   * something a $0-budget founder can undo.
   */
  LLM_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(10),

  OPENAI_BASE_URL: httpUrl("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),

  // --- Data layer ---------------------------------------------------------
  /**
   * Public origin the tracking snippet posts to. Grape runs on localhost, but
   * the snippet is loaded by a browser on the open internet, so this has to be
   * a publicly reachable origin — during development, a cloudflared quick
   * tunnel. It changes every time the tunnel restarts, which is why the
   * snippet is generated on demand rather than written down once.
   */
  INGEST_BASE_URL: httpUrl("http://localhost:3000"),

  /**
   * Below this many sessions in the window there is not enough traffic to talk
   * about conversion rates, so diagnosis falls back to a static audit of the
   * site itself. The target user starts at zero traffic, so this path is the
   * common case on day one, not an edge case.
   */
  COLD_START_MIN_SESSIONS: z.coerce.number().int().positive().default(30),

  // --- Action layer -------------------------------------------------------
  /**
   * Posting to X is irreversible and metered (~$0.20 per post containing a
   * link, as of the Feb 2026 pricing change). Dry run stays on unless the
   * value is *exactly* "false" — a typo must not start publishing.
   */
  GRAPE_ACTION_DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() !== "false"),

  /**
   * Events older than this are deleted. Without a ceiling the ingest endpoint
   * is an unbounded write path with no authentication in front of it.
   */
  GRAPE_EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(180),

  /**
   * Signs the session cookie, and so decides whether there can be sessions at
   * all. Unset is allowed only on a developer's machine, where a non-production
   * build reached over loopback falls back to a well-known key — see
   * src/server/session.ts. Anywhere else, unset means every page answers 503.
   */
  GRAPE_SESSION_SECRET: z.string().optional(),

  /**
   * Both optional, and both required together: "Sign in with Google" is a
   * button that appears when there is somewhere for it to send someone, not a
   * thing every install must set up. From the OAuth client's own page in
   * Google Cloud Console; there is no default because a placeholder client id
   * would silently fail against Google rather than telling anyone to set this.
   */
  GOOGLE_CLIENT_ID: z.string().trim().optional(),
  GOOGLE_CLIENT_SECRET: z.string().trim().optional(),

  // --- Operations ---------------------------------------------------------
  GRAPE_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  X_CONSUMER_KEY: z.string().optional(),
  X_CONSUMER_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_TOKEN_SECRET: z.string().optional(),
});

/**
 * Whether a URL's host is loopback — a self-hosted server (LM Studio, vLLM,
 * llama.cpp) that genuinely has no key to give. Exported so
 * core/llm/index.ts can apply the same exemption when it decides whether a
 * user's missing openai-compat key is actually a problem; kept here rather
 * than duplicated because OPENAI_BASE_URL's shape is this module's to know.
 */
export function isLocalHost(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}

/**
 * Cross-field rules the per-field schema cannot express.
 *
 * API keys used to live here too — `anthropic` required `ANTHROPIC_API_KEY`,
 * `openai-compat` required `OPENAI_API_KEY` unless the endpoint was local —
 * back when one instance-wide credential served every account. Now each
 * account brings its own key (core/auth/users.ts), so there is nothing left
 * for this schema to cross-check: `LLM_PROVIDER` alone says which service is
 * in play, and `getProvider()` is where a *specific user's* credential is
 * required or not.
 */
const CheckedEnvSchema = EnvSchema.superRefine((value, ctx) => {
  // Half a pair is worse than neither half: it would show a "Googleでログイン"
  // button that fails every attempt with a Google-side "invalid_client",
  // rather than one that simply does not appear.
  if (Boolean(value.GOOGLE_CLIENT_ID) === Boolean(value.GOOGLE_CLIENT_SECRET)) return;

  const missing = value.GOOGLE_CLIENT_ID ? "GOOGLE_CLIENT_SECRET" : "GOOGLE_CLIENT_ID";
  ctx.addIssue({
    code: "custom",
    path: [missing],
    message: "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together, or not at all",
  });
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Whether the instance has picked a service to talk to at all. `LLM_PROVIDER`
 * being set no longer guarantees a working credential the way it did when one
 * instance-wide key served every account — each user's own key (or lack of
 * one) is checked separately, per request, by `getProvider()` in
 * core/llm/index.ts.
 */
export function aiAvailable(settings: Pick<Env, "LLM_PROVIDER">): boolean {
  return settings.LLM_PROVIDER !== undefined;
}

/**
 * Treat blank env vars as absent. `FOO=` in a .env file otherwise beats the
 * schema default with an empty string.
 */
function definedEntries(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value.trim() !== "") out[key] = value;
  }
  return out;
}

/**
 * A host that already knows its own public address tells us, so the tracking
 * snippet is correct the moment the service first boots.
 *
 * This matters more than it looks. INGEST_BASE_URL falls back to localhost,
 * which is right on a developer's machine and silently wrong on a deployment:
 * the snippet is copied onto a real site, posts to http://localhost:3000 from
 * a stranger's browser, and no event ever arrives — with nothing anywhere
 * saying why. Render publishes RENDER_EXTERNAL_URL for exactly this.
 *
 * An explicit INGEST_BASE_URL still wins, as does the /settings override
 * stored in SQLite, so a custom domain is one field and no redeploy.
 */
function withHostProvidedOrigin(source: Record<string, string>): Record<string, string> {
  if (source.INGEST_BASE_URL || !source.RENDER_EXTERNAL_URL) return source;
  return { ...source, INGEST_BASE_URL: source.RENDER_EXTERNAL_URL };
}

/** Takes its source as an argument so the rules above are testable without mutating process.env. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = CheckedEnvSchema.safeParse(withHostProvidedOrigin(definedEntries(source)));
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return parsed.data;
}

export const env: Env = parseEnv(process.env);

/**
 * GRAPE_ADMIN_PASSWORD was the whole authentication system: one shared
 * password, and a session cookie whose key was derived from it. Passwords are
 * now per-account and hashed, so there is nothing left for it to do and
 * nothing left to derive a key from.
 *
 * Said out loud rather than ignored in silence, because an operator who still
 * has it in their .env is holding a belief about how this instance is guarded
 * that stopped being true.
 */
if (process.env.GRAPE_ADMIN_PASSWORD) {
  console.warn(
    "[grape] GRAPE_ADMIN_PASSWORD is no longer used and is being ignored. " +
      "Accounts have their own passwords now; GRAPE_SESSION_SECRET is what signs sessions. " +
      "You can remove it from .env.",
  );
}
