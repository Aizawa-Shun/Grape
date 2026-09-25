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
   * Public origin the tracking snippet posts to. Optional on App Hosting: left
   * unset, the snippet uses the origin its page was served from (see
   * server/public-origin.ts). Set it for a custom domain, or locally to a
   * cloudflared quick tunnel — the snippet runs in a browser on the open
   * internet, which cannot reach localhost.
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
   * The key API keys are encrypted with in Firestore (server/secret-box.ts).
   * Required in production — on App Hosting it is a Secret Manager secret
   * referenced from apphosting.yaml — and optional elsewhere, where a
   * development key applies. Changing it makes every stored API key
   * unreadable; each account then adds theirs again from /account.
   */
  GRAPE_ENCRYPTION_KEY: z.string().trim().min(16).optional(),

  /**
   * What a scheduler presents to POST /api/cron/tick, as a bearer token. Unset
   * means the endpoint answers 503 and the loop only runs by hand (`pnpm
   * loop:tick`) — there is no default, because a guessable value would let
   * anyone on the internet trigger model calls billed to every account.
   */
  GRAPE_CRON_SECRET: z.string().trim().min(16).optional(),

  // --- Firebase -----------------------------------------------------------
  /**
   * The web app's public config (apiKey, authDomain, projectId, appId) as
   * JSON, handed to the browser so the Firebase client SDK can sign people
   * in. App Hosting sets this itself at build and run time; locally, copy it
   * from the Firebase console's project settings — or leave it unset when
   * running against the emulators, which accept a demo config (see
   * server/auth/firebase-web.ts).
   */
  FIREBASE_WEBAPP_CONFIG: z.string().optional(),

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
 * Cross-field rules the per-field schema cannot express — none at the moment.
 * API keys used to be checked here against LLM_PROVIDER, and the Google
 * OAuth client id against its secret; the first are per-account now
 * (core/auth/users.ts) and Google sign-in is Firebase Authentication's.
 * Kept as its own name so parseEnv reads the same when one returns.
 */
const CheckedEnvSchema = EnvSchema;

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

/** Takes its source as an argument so the rules above are testable without mutating process.env. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = CheckedEnvSchema.safeParse(definedEntries(source));
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
 * Variables from earlier designs that no longer do anything. Said out loud
 * rather than ignored in silence, because an operator who still has one set is
 * holding a belief about how this instance works that stopped being true.
 */
const RETIRED: Record<string, string> = {
  GRAPE_ADMIN_PASSWORD: "sign-in is Firebase Authentication now",
  GRAPE_SESSION_SECRET: "sessions are Firebase session cookies now; API keys are encrypted with GRAPE_ENCRYPTION_KEY",
  DATABASE_URL: "the database is Firestore now",
  DATABASE_AUTH_TOKEN: "the database is Firestore now",
  GOOGLE_CLIENT_ID: "Google sign-in is configured in Firebase Authentication now",
  GOOGLE_CLIENT_SECRET: "Google sign-in is configured in Firebase Authentication now",
};

for (const [name, reason] of Object.entries(RETIRED)) {
  if (process.env[name]) console.warn(`[grape] ${name} is no longer used and is being ignored: ${reason}.`);
}
