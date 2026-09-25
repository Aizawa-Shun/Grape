import { env } from "@/env";

/**
 * The Firebase web config the browser needs to sign in, and where the Auth
 * emulator is when one is running.
 *
 * Read on the server and passed to the sign-in forms as props, rather than
 * baked into the bundle through NEXT_PUBLIC_* variables at build time: App
 * Hosting provides FIREBASE_WEBAPP_CONFIG at run time as well, so one build
 * serves any project it is deployed to. None of these values is a secret —
 * a Firebase web apiKey identifies the project, it does not authorize
 * anything; the security rules and this server do that.
 */
export interface WebAppConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId?: string;
}

export interface ClientAuthSettings {
  config: WebAppConfig;
  /** "127.0.0.1:9099" when the Auth emulator is in use, else null. */
  emulatorHost: string | null;
}

export function clientAuthSettings(): ClientAuthSettings | null {
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? null;

  if (env.FIREBASE_WEBAPP_CONFIG) {
    try {
      const parsed = JSON.parse(env.FIREBASE_WEBAPP_CONFIG) as Partial<WebAppConfig>;
      if (parsed.apiKey && parsed.projectId) {
        return {
          config: {
            apiKey: parsed.apiKey,
            authDomain: parsed.authDomain ?? `${parsed.projectId}.firebaseapp.com`,
            projectId: parsed.projectId,
            appId: parsed.appId,
          },
          emulatorHost,
        };
      }
    } catch {
      // Fall through: an unparseable config is the same as none, below.
    }
  }

  // The emulators accept any apiKey, so local development needs no console
  // round-trip — only the project id the emulators were started with.
  if (emulatorHost) {
    const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT ?? "demo-grape";
    return {
      config: { apiKey: "demo-api-key", authDomain: `${projectId}.firebaseapp.com`, projectId },
      emulatorHost,
    };
  }

  return null;
}
