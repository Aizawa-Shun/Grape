import { describe, expect, it } from "vitest";

import { cronAuthorized } from "./cron-auth";

const SECRET = "a-long-random-cron-secret-value";

describe("cronAuthorized", () => {
  it("accepts the secret as a bearer token", () => {
    expect(cronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(cronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses a missing header, another scheme, or a wrong value", () => {
    expect(cronAuthorized(null, SECRET)).toBe(false);
    expect(cronAuthorized(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(cronAuthorized("Bearer nope", SECRET)).toBe(false);
    expect(cronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
  });
});
