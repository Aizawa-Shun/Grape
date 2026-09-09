import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "./proxy";
import { SESSION_COOKIE, issueSession, sessionSecret } from "./server/session";

const SECRET = "configured-secret";

function request(
  path: string,
  { host = "localhost:3000", cookie }: { host?: string; cookie?: string } = {},
): NextRequest {
  const headers = new Headers({ host });
  if (cookie) headers.set("cookie", `${SESSION_COOKIE}=${cookie}`);
  return new NextRequest(`http://${host}${path}`, { headers });
}

/** What the proxy did, reduced to the three outcomes that differ. */
function outcome(response: Response) {
  return {
    status: response.status,
    location: response.headers.get("location"),
    setsSession: (response.headers.get("set-cookie") ?? "").includes(SESSION_COOKIE),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("proxy", () => {
  it.each(["/api/collect", "/g.js", "/login", "/register", "/api/health"])(
    "lets %s through with no session at all",
    async (path) => {
      vi.stubEnv("GRAPE_SESSION_SECRET", "");
      vi.stubEnv("NODE_ENV", "production");

      expect(outcome(await proxy(request(path, { host: "grape.example.com" }))).status).toBe(200);
    },
  );

  /**
   * The deployment case with nothing configured. Closed rather than open:
   * everything behind here reads the funnel and spends money.
   */
  it("refuses everything on a public host when no secret is configured", async () => {
    vi.stubEnv("GRAPE_SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(outcome(await proxy(request("/", { host: "grape.example.com" }))).status).toBe(503);
  });

  it("refuses even loopback in a production build, where the developer fallback does not apply", async () => {
    vi.stubEnv("GRAPE_SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");

    expect(outcome(await proxy(request("/"))).status).toBe(503);
  });

  /**
   * What keeps `pnpm dev` working with an empty .env. It signs a real token
   * rather than waving the request through, so the Node side has exactly one
   * way to learn who is asking.
   */
  it("signs itself in as the developer on loopback in a non-production build", async () => {
    vi.stubEnv("GRAPE_SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");

    expect(outcome(await proxy(request("/")))).toMatchObject({ status: 200, setsSession: true });
  });

  it("does not extend the developer fallback past loopback", async () => {
    vi.stubEnv("GRAPE_SESSION_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");

    expect(outcome(await proxy(request("/", { host: "grape.example.com" }))).status).toBe(503);
  });

  /**
   * Setting a secret is how a developer asks for real accounts; silently
   * signing them in as somebody else would be a strange way to honour that.
   */
  it("asks for a login on loopback once a secret is configured", async () => {
    vi.stubEnv("GRAPE_SESSION_SECRET", SECRET);
    vi.stubEnv("NODE_ENV", "development");

    expect(outcome(await proxy(request("/")))).toMatchObject({
      status: 307,
      setsSession: false,
    });
  });

  it("sends an unauthenticated page to the login screen, remembering where it was headed", async () => {
    vi.stubEnv("GRAPE_SESSION_SECRET", SECRET);
    vi.stubEnv("NODE_ENV", "production");

    const { status, location } = outcome(
      await proxy(request("/products/abc", { host: "grape.example.com" })),
    );
    expect(status).toBe(307);
    expect(location).toContain("/login?next=%2Fproducts%2Fabc");
  });

  it("answers an unauthenticated API call with 401 rather than a redirect", async () => {
    vi.stubEnv("GRAPE_SESSION_SECRET", SECRET);
    vi.stubEnv("NODE_ENV", "production");

    expect(outcome(await proxy(request("/api/products", { host: "grape.example.com" })))).toMatchObject({
      status: 401,
      location: null,
    });
  });

  it("lets a valid session through", async () => {
    vi.stubEnv("GRAPE_SESSION_SECRET", SECRET);
    vi.stubEnv("NODE_ENV", "production");
    const token = await issueSession(SECRET, "user-1");

    expect(outcome(await proxy(request("/", { host: "grape.example.com", cookie: token }))).status).toBe(200);
  });

  it("refuses a session signed with someone else's secret", async () => {
    vi.stubEnv("GRAPE_SESSION_SECRET", SECRET);
    vi.stubEnv("NODE_ENV", "production");
    const token = await issueSession("a-different-secret", "user-1");

    expect(outcome(await proxy(request("/", { host: "grape.example.com", cookie: token }))).status).toBe(307);
  });

  /**
   * The developer key is not a secret and is compiled into every build, so it
   * must never be what stands between a deployment and its data.
   */
  it("does not accept a token signed with the developer key on a public host", async () => {
    vi.stubEnv("GRAPE_SESSION_SECRET", SECRET);
    vi.stubEnv("NODE_ENV", "production");
    const devKey = sessionSecret(undefined, true);
    const token = await issueSession(devKey as string, "user-1");

    expect(outcome(await proxy(request("/", { host: "grape.example.com", cookie: token }))).status).toBe(307);
  });
});
