import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runWithRequestId } from "./context";
import { describeError, log } from "./log";

function captureLines() {
  const lines: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    lines.push(String(chunk));
    return true;
  });
  return lines;
}

beforeEach(() => {
  process.env.GRAPE_LOG_FORMAT = "json";
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.GRAPE_LOG_FORMAT;
});

describe("log", () => {
  it("writes one JSON line carrying the event and its fields", () => {
    const lines = captureLines();

    log.info("action.dry_run", { channel: "x", taskId: "t1" });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]);
    expect(record).toMatchObject({ lvl: "info", evt: "action.dry_run", channel: "x", taskId: "t1" });
    expect(Date.parse(record.t)).not.toBeNaN();
  });

  it("drops fields that are undefined rather than emitting nulls", () => {
    const lines = captureLines();

    log.info("crawl.page", { url: "https://example.com", status: undefined });

    expect(JSON.parse(lines[0])).not.toHaveProperty("status");
  });

  it("stays silent below the configured level", () => {
    const lines = captureLines();

    log.debug("noisy.detail");

    expect(lines).toHaveLength(0);
  });

  it("stamps the surrounding request id without being handed it", () => {
    const lines = captureLines();

    runWithRequestId("req-123", () => {
      log.warn("crawl.browser_unavailable", { reason: "chromium missing" });
    });

    expect(JSON.parse(lines[0]).req).toBe("req-123");
  });

  it("carries the request id across awaits, which is the only reason it exists", async () => {
    const lines = captureLines();

    await runWithRequestId("req-456", async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      log.info("llm.call");
    });

    expect(JSON.parse(lines[0]).req).toBe("req-456");
  });

  it("has no request id outside a request", () => {
    const lines = captureLines();

    log.info("startup");

    expect(JSON.parse(lines[0])).not.toHaveProperty("req");
  });

  it("prints multi-line values on their own lines in human mode", () => {
    process.env.GRAPE_LOG_FORMAT = "human";
    const lines = captureLines();

    log.info("action.dry_run", { channel: "x", content: "一行目\n二行目" });

    expect(lines[0]).toContain("channel=x");
    expect(lines[0]).toContain("\n    一行目\n    二行目");
  });
});

describe("describeError", () => {
  it("keeps the message and trims the stack to where it was thrown", () => {
    const fields = describeError(new Error("boom"));

    expect(fields.error).toBe("boom");
    expect(fields.errorName).toBe("Error");
    expect(String(fields.stack).split("\n").length).toBeLessThanOrEqual(5);
  });

  it("unwraps a cause, which is where the real reason usually is", () => {
    const fields = describeError(new Error("wrapper", { cause: new Error("ECONNREFUSED") }));

    expect(fields.cause).toBe("ECONNREFUSED");
  });

  it("survives something that is not an Error", () => {
    expect(describeError("just a string")).toEqual({ error: "just a string" });
  });
});
