import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";
import { SESSION_COOKIE } from "./server/session";

function request(path: string, { cookie }: { cookie?: string } = {}): NextRequest {
  const headers = new Headers({ host: "grape.example.com" });
  if (cookie) headers.set("cookie", `${SESSION_COOKIE}=${cookie}`);
  return new NextRequest(`https://grape.example.com${path}`, { headers });
}

/**
 * The proxy only checks that a session cookie is present — verification needs
 * the Admin SDK, which does not run on the Edge, and happens in Node on every
 * page and route (server/auth/current-user.ts). These tests hold it to that
 * narrower job.
 */
describe("proxy", () => {
  it.each(["/icon.png", "/apple-icon.png", "/icon1.png", "/icon.svg", "/favicon.ico"])(
    "serves %s without a session, so the tab icon renders signed out",
    async (path) => {
      expect((await proxy(request(path))).status).toBe(200);
    },
  );

  it("does not open a page merely because its name starts with icon", async () => {
    expect((await proxy(request("/icons"))).status).toBe(307);
  });

  it.each(["/api/collect", "/g.js", "/login", "/register", "/api/health", "/api/cron/tick", "/api/auth/session"])(
    "lets %s through with no session at all",
    async (path) => {
      expect((await proxy(request(path))).status).toBe(200);
    },
  );

  it("sends a signed-out browser to /login, remembering where it was going", async () => {
    const response = await proxy(request("/products/abc?tab=1"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/products/abc?tab=1");
  });

  it("answers a signed-out API call with a 401, not an HTML redirect", async () => {
    const response = await proxy(request("/api/products"));

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  /** Presence only: whether the cookie is genuine is the Node side's question. */
  it("passes a request carrying a session cookie on to be verified", async () => {
    const response = await proxy(request("/", { cookie: "anything" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-request-id")).toBeTruthy();
  });
});
