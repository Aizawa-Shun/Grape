import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const incoming = { headers: new Headers() };
vi.mock("next/headers", () => ({ headers: async () => incoming.headers }));

const settings = { overrides: {} as Record<string, string>, ingest: "http://localhost:3000" };
vi.mock("@/core/settings", () => ({
  currentOverrides: () => settings.overrides,
  currentSettings: () => ({ INGEST_BASE_URL: settings.ingest }),
}));

beforeEach(() => {
  incoming.headers = new Headers();
  settings.overrides = {};
  settings.ingest = "http://localhost:3000";
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicIngestOrigin", () => {
  /** The deployed default: no configuration, and the snippet still points somewhere real. */
  it("uses the origin the page was served from when nothing is configured", async () => {
    vi.stubEnv("INGEST_BASE_URL", "");
    incoming.headers = new Headers({ "x-forwarded-host": "grape--demo.asia-east1.hosted.app", "x-forwarded-proto": "https" });

    const { publicIngestOrigin } = await import("./public-origin");
    expect(await publicIngestOrigin()).toBe("https://grape--demo.asia-east1.hosted.app");
  });

  it("assumes https for a public host that did not say", async () => {
    vi.stubEnv("INGEST_BASE_URL", "");
    incoming.headers = new Headers({ host: "grape.example.com" });

    const { publicIngestOrigin } = await import("./public-origin");
    expect(await publicIngestOrigin()).toBe("https://grape.example.com");
  });

  /** A custom domain is exactly when the request's own host may be the wrong answer. */
  it("lets a configured origin win, from the environment or from /settings", async () => {
    incoming.headers = new Headers({ host: "grape--demo.asia-east1.hosted.app" });
    settings.ingest = "https://grape.example.com";
    const { publicIngestOrigin } = await import("./public-origin");

    vi.stubEnv("INGEST_BASE_URL", "https://grape.example.com");
    expect(await publicIngestOrigin()).toBe("https://grape.example.com");

    vi.stubEnv("INGEST_BASE_URL", "");
    settings.overrides = { INGEST_BASE_URL: "https://grape.example.com" };
    expect(await publicIngestOrigin()).toBe("https://grape.example.com");
  });
});
