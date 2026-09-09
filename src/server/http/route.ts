import { NextResponse } from "next/server";

import { toAppError } from "@/core/errors";
import { loadSettings } from "@/core/settings";
import { dbReady } from "@/db/client";

import { sessionUserIdFor } from "../auth/current-user";
import { runInRequestScope } from "../context";
import { describeError, log } from "../log";
import { describeForUser, statusOf } from "./errors";

/**
 * Wraps a route handler so that every route gets the same three things it was
 * previously either copy-pasting or missing entirely: a request id, one log
 * line, and an error response whose status comes from what actually failed
 * rather than from a per-route constant.
 *
 * Before this, POST /api/products answered 502 for a malformed URL, a browser
 * launch failure and a disk error alike, PUT .../context answered 404 for any
 * database error, and three routes had no catch at all and fell through to
 * Next's HTML 500 page.
 *
 * The response keeps `error` as a plain string so the six client components
 * reading `body.error` keep working untouched; `code` is added alongside for
 * the UI to branch on.
 */
export const REQUEST_ID_HEADER = "x-request-id";

export function route<Ctx>(
  name: string,
  handler: (request: Request, context: Ctx) => Promise<Response>,
): (request: Request, context: Ctx) => Promise<Response> {
  return async (request, context) => {
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? crypto.randomUUID();
    const startedAt = Date.now();
    // Verified from the cookie, not loaded from the database: this runs on
    // every request including the ingest path. Undefined on the public routes,
    // which is why nothing downstream may assume there is an account.
    const userId = await sessionUserIdFor(request);

    return runInRequestScope({ requestId, userId }, async () => {
      const path = new URL(request.url).pathname;

      try {
        // Cheap after the first call; guarantees no handler queries the
        // database before its pragmas are applied.
        await dbReady;
        // Warms the settings cache so the synchronous readers — log.ts most of
        // all — see the stored overrides rather than the .env defaults. A
        // stored value that no longer validates must not take the request down
        // with it: loadSettings has already fallen back to .env by this point,
        // so noting it and carrying on is the correct response.
        await loadSettings().catch((error: unknown) =>
          log.warn("settings.unusable", describeError(error)),
        );
        const response = await handler(request, context);
        log.info("request", {
          route: name,
          method: request.method,
          path,
          status: response.status,
          ms: Date.now() - startedAt,
        });
        response.headers.set(REQUEST_ID_HEADER, requestId);
        return response;
      } catch (error) {
        const appError = toAppError(error);
        const status = statusOf(appError);

        // The technical side — including whatever the model actually returned —
        // goes here and only here.
        log.error("request.failed", {
          route: name,
          method: request.method,
          path,
          status,
          ms: Date.now() - startedAt,
          code: appError.code,
          ...describeError(appError),
        });

        return NextResponse.json(
          { error: describeForUser(appError), code: appError.code, requestId },
          { status, headers: { [REQUEST_ID_HEADER]: requestId } },
        );
      }
    });
  };
}
