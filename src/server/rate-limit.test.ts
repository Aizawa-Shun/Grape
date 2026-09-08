import { beforeEach, describe, expect, it } from "vitest";

import { clientAddress, resetRateLimits, takeToken } from "./rate-limit";

const bucket = { capacity: 3, refillPerSec: 1 };

beforeEach(resetRateLimits);

describe("takeToken", () => {
  it("allows a burst up to the capacity, then refuses", () => {
    const now = 1_000_000;

    for (let i = 0; i < 3; i++) {
      expect(takeToken("k", bucket, now).ok, `call ${i}`).toBe(true);
    }
    expect(takeToken("k", bucket, now).ok).toBe(false);
  });

  it("refills over time rather than staying closed", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) takeToken("k", bucket, now);

    expect(takeToken("k", bucket, now + 500).ok).toBe(false);
    expect(takeToken("k", bucket, now + 1_000).ok).toBe(true);
  });

  it("says how long to wait, which is what the Retry-After header carries", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) takeToken("k", bucket, now);

    const decision = takeToken("k", bucket, now);
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.retryAfterSec).toBeGreaterThan(0);
  });

  it("keeps separate keys independent, so one noisy client cannot close another", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) takeToken("noisy", bucket, now);

    expect(takeToken("noisy", bucket, now).ok).toBe(false);
    expect(takeToken("quiet", bucket, now).ok).toBe(true);
  });

  it("never banks more than the capacity however long it idles", () => {
    const now = 1_000_000;
    takeToken("k", bucket, now);

    for (let i = 0; i < 3; i++) expect(takeToken("k", bucket, now + 86_400_000).ok).toBe(true);
    expect(takeToken("k", bucket, now + 86_400_000).ok).toBe(false);
  });
});

describe("clientAddress", () => {
  it("prefers the proxy header the tunnel actually sets", () => {
    const request = new Request("http://x/", {
      headers: { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8, 9.9.9.9" },
    });

    expect(clientAddress(request)).toBe("1.2.3.4");
  });

  it("takes the first hop of x-forwarded-for otherwise", () => {
    const request = new Request("http://x/", {
      headers: { "x-forwarded-for": "5.6.7.8, 9.9.9.9" },
    });

    expect(clientAddress(request)).toBe("5.6.7.8");
  });

  it("still returns a usable key when nothing identifies the caller", () => {
    expect(clientAddress(new Request("http://x/"))).toBe("unknown");
  });
});
