import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ChannelError } from "@/core/action/channel";
import { AppError, ERROR_CODES, toAppError } from "@/core/errors";
import { LLMError } from "@/core/llm/types";

import { catalogEntry, describeForUser } from "./errors";
import { REQUEST_ID_HEADER, route } from "./route";

function silenceLogs() {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
}

function get(url = "http://localhost/api/thing"): Request {
  return new Request(url);
}

describe("error catalog", () => {
  it("has an entry for every code, so no failure can fall through to a blank message", () => {
    for (const code of ERROR_CODES) {
      const entry = catalogEntry(code);
      expect(entry.text.length, code).toBeGreaterThan(0);
      expect(entry.status, code).toBeGreaterThanOrEqual(400);
    }
  });

  it("tells the reader what to do, not just what broke", () => {
    // Every entry ends its advice with a request — the review rule this file
    // exists to enforce. "…してください。" is how that reads in Japanese.
    for (const code of ERROR_CODES) {
      expect(catalogEntry(code).text, code).toMatch(/ください。$/);
    }
  });

  it("appends the hint the throw site supplied", () => {
    const message = describeForUser(new AppError("TOO_EARLY", "internal detail", { hint: "あと3日" }));

    expect(message).toContain("あと3日");
    expect(message).not.toContain("internal detail");
  });
});

describe("toAppError", () => {
  it("classifies each LLM failure kind rather than string-matching the message", () => {
    const cases = [
      ["unreachable", "LLM_UNREACHABLE"],
      ["timeout", "LLM_TIMEOUT"],
      ["auth", "LLM_AUTH"],
      ["rate_limited", "LLM_RATE_LIMITED"],
      ["bad_output", "LLM_BAD_OUTPUT"],
      ["refused", "LLM_REFUSED"],
      ["server_error", "LLM_UNREACHABLE"],
    ] as const;

    for (const [failure, code] of cases) {
      expect(toAppError(new LLMError("boom", "anthropic", failure)).code).toBe(code);
    }
  });

  it("separates a missing credential from a rejected post", () => {
    expect(toAppError(new ChannelError("no keys", "x", "auth")).code).toBe("CHANNEL_AUTH");
    expect(toAppError(new ChannelError("too long", "x", "rejected")).code).toBe("CHANNEL_FAILED");
  });

  it("turns a schema failure into invalid input", () => {
    const result = z.object({ url: z.string() }).safeParse({});
    expect(toAppError(result.error).code).toBe("INVALID_INPUT");
  });

  it("recognises a drizzle query failure as a storage problem, not a generic one", () => {
    expect(toAppError(new Error("Failed query: insert into products")).code).toBe("DB_ERROR");
  });

  it("passes an AppError through untouched", () => {
    const original = new AppError("NOT_FOUND", "no such product");
    expect(toAppError(original)).toBe(original);
  });

  it("falls back to INTERNAL for anything unrecognised", () => {
    expect(toAppError(new Error("???")).code).toBe("INTERNAL");
    expect(toAppError("a bare string").code).toBe("INTERNAL");
  });
});

describe("route", () => {
  it("never leaks the technical message — including raw model output — to the caller", async () => {
    silenceLogs();
    const rawModelOutput = 'Sure! Here is your JSON: {"summary": "…';
    const handler = route("test", async () => {
      throw new LLMError(
        `Model output for "diagnosis" was not valid JSON: ${rawModelOutput}`,
        "anthropic",
        "bad_output",
      );
    });

    const response = await handler(get(), undefined);
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.code).toBe("LLM_BAD_OUTPUT");
    expect(body.error).not.toContain(rawModelOutput);
    expect(body.error).not.toContain("JSON");
  });

  it("derives the status from what failed instead of a per-route constant", async () => {
    silenceLogs();
    const notFound = route("test", async () => {
      throw new AppError("NOT_FOUND", "gone");
    });
    const badInput = route("test", async () => {
      throw new AppError("INVALID_INPUT", "nope");
    });

    expect((await notFound(get(), undefined)).status).toBe(404);
    expect((await badInput(get(), undefined)).status).toBe(400);
  });

  it("returns a request id on success and on failure so a report can be traced to a log line", async () => {
    silenceLogs();
    const ok = route("test", async () => Response.json({ fine: true }));
    const bad = route("test", async () => {
      throw new Error("boom");
    });

    const okResponse = await ok(get(), undefined);
    expect(okResponse.headers.get(REQUEST_ID_HEADER)).toBeTruthy();

    const badResponse = await bad(get(), undefined);
    const body = await badResponse.json();
    expect(body.requestId).toBe(badResponse.headers.get(REQUEST_ID_HEADER));
  });

  it("adopts an inbound request id rather than minting a second one", async () => {
    silenceLogs();
    const handler = route("test", async () => Response.json({}));

    const request = new Request("http://localhost/api/thing", {
      headers: { [REQUEST_ID_HEADER]: "given-by-middleware" },
    });

    expect((await handler(request, undefined)).headers.get(REQUEST_ID_HEADER)).toBe(
      "given-by-middleware",
    );
  });

  it("logs the technical detail that the response withholds", async () => {
    const lines: string[] = [];
    process.env.GRAPE_LOG_FORMAT = "json";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      lines.push(String(chunk));
      return true;
    });

    const handler = route("diagnose.run", async () => {
      throw new LLMError("Provider returned 500: out of memory", "anthropic", "server_error");
    });
    await handler(get(), undefined);

    const failure = lines.map((line) => JSON.parse(line)).find((r) => r.evt === "request.failed");
    expect(failure.error).toContain("out of memory");
    expect(failure.code).toBe("LLM_UNREACHABLE");
    expect(failure.route).toBe("diagnose.run");

    vi.restoreAllMocks();
    delete process.env.GRAPE_LOG_FORMAT;
  });
});
