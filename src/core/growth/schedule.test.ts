import { describe, expect, it } from "vitest";

import { dayAfter, interleave, planDates } from "./schedule";

/** 12:00 in Japan on 2026-09-01. */
const noon = new Date("2026-09-01T03:00:00Z");
/** 22:00 in Japan on 2026-09-01. */
const night = new Date("2026-09-01T13:00:00Z");

describe("planDates", () => {
  it("starts today, one post a day", () => {
    expect(planDates(3, noon, 1, {})).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("starts tomorrow once the day is nearly over", () => {
    expect(planDates(1, night, 1, {})[0]).toBe("2026-09-02");
  });

  it("skips days that already hold their share, so a top-up never doubles a day", () => {
    expect(planDates(2, noon, 1, { "2026-09-01": 1, "2026-09-02": 1 })).toEqual(["2026-09-03", "2026-09-04"]);
    expect(planDates(3, noon, 2, { "2026-09-01": 1 })).toEqual(["2026-09-01", "2026-09-02", "2026-09-02"]);
  });

  it("rolls over at midnight in Japan, not UTC", () => {
    expect(dayAfter(new Date("2026-09-01T15:30:00Z"), 0)).toBe("2026-09-02");
  });
});

describe("interleave", () => {
  it("alternates the groups so each hypothesis meets every weekday alike", () => {
    expect(interleave([["A1", "A2", "A3"], ["B1", "B2"]])).toEqual(["A1", "B1", "A2", "B2", "A3"]);
  });
});
