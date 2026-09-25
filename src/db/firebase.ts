import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * The one Firebase Admin app this server uses, for Firestore and for
 * verifying Authentication sessions.
 *
 * `initializeApp()` with no arguments is deliberate. On App Hosting the
 * runtime provides both the project (FIREBASE_CONFIG) and the credentials
 * (the service account the backend runs as), so there is nothing to
 * configure. Locally it reads the same variables the Firebase tooling does:
 * GOOGLE_CLOUD_PROJECT or FIREBASE_PROJECT_ID for the project, and
 * FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST to talk to the
 * emulators instead of production — which `pnpm dev:emulators` sets for you.
 *
 * Server-only: the Admin SDK bypasses every security rule, and reaching it
 * from a browser bundle would be both a build failure and, if it ever
 * succeeded, a hole.
 */
if (typeof window !== "undefined") {
  throw new Error("@/db/firebase was imported into the browser bundle.");
}

const globalForFirebase = globalThis as typeof globalThis & { __grapeFirestore?: Firestore };

export function firebaseApp(): App {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  return initializeApp(projectId ? { projectId } : undefined);
}

/**
 * Cached on globalThis because Next's dev server re-evaluates modules on every
 * hot reload, and `settings()` may only be called once per Firestore instance.
 */
export function firestore(): Firestore {
  if (globalForFirebase.__grapeFirestore) return globalForFirebase.__grapeFirestore;
  const instance = getFirestore(firebaseApp());
  instance.settings({ ignoreUndefinedProperties: true });
  globalForFirebase.__grapeFirestore = instance;
  return instance;
}

export function firebaseAuth(): Auth {
  return getAuth(firebaseApp());
}
