import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { GOOGLE_CLIENT_ID: undefined as string | undefined, GOOGLE_CLIENT_SECRET: undefined as string | undefined },
}));

afterEach(() => {
  vi.resetModules();
});

describe("googleSignInAvailable", () => {
  it("is false with neither configured, the default install", async () => {
    const { env } = await import("@/env");
    env.GOOGLE_CLIENT_ID = undefined;
    env.GOOGLE_CLIENT_SECRET = undefined;

    const { googleSignInAvailable } = await import("./google");
    expect(googleSignInAvailable()).toBe(false);
  });

  it("is true once both are set", async () => {
    const { env } = await import("@/env");
    env.GOOGLE_CLIENT_ID = "id";
    env.GOOGLE_CLIENT_SECRET = "secret";

    const { googleSignInAvailable } = await import("./google");
    expect(googleSignInAvailable()).toBe(true);
  });
});

describe("googleAuthorizationUrl", () => {
  it("carries the redirect URI, state and this app's requested scope to Google", async () => {
    const { env } = await import("@/env");
    env.GOOGLE_CLIENT_ID = "test-client-id";
    env.GOOGLE_CLIENT_SECRET = "test-client-secret";

    const { googleAuthorizationUrl } = await import("./google");
    const url = new URL(
      googleAuthorizationUrl("https://grape.example.com/api/auth/google/callback", "the-state"),
    );

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://grape.example.com/api/auth/google/callback",
    );
    expect(url.searchParams.get("state")).toBe("the-state");
    expect(url.searchParams.get("response_type")).toBe("code");
    // openid is what makes Google return a `sub` at all — without it there is
    // no stable id for signInWithGoogle to key an account on.
    expect(url.searchParams.get("scope")).toBe("openid email profile");
  });
});
