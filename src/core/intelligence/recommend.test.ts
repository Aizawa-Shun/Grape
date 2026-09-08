import { describe, expect, it } from "vitest";

import { isoWeekString } from "./recommend";

describe("isoWeekString", () => {
  it("formats an ordinary midweek date", () => {
    // 2026-09-07 is a Monday.
    expect(isoWeekString(new Date("2026-09-07T00:00:00Z"))).toBe("2026-W37");
  });

  it("assigns the last days of December to next year's week 1 when the ISO week crosses the boundary", () => {
    // 2025-12-29 is a Monday, so ISO week 1 of 2026 starts here even though
    // the calendar date is still in December.
    expect(isoWeekString(new Date("2025-12-29T00:00:00Z"))).toBe("2026-W01");
  });

  it("assigns the first days of January to the previous year's last week when appropriate", () => {
    // 2027-01-01 is a Friday; its Thursday falls in December 2026, so ISO
    // considers it the last week of 2026, not the first week of 2027.
    expect(isoWeekString(new Date("2027-01-01T00:00:00Z"))).toBe("2026-W53");
  });

  it("is stable across every day of the same ISO week", () => {
    const week = isoWeekString(new Date("2026-09-07T00:00:00Z"));
    for (const day of ["2026-09-08", "2026-09-09", "2026-09-13"]) {
      expect(isoWeekString(new Date(`${day}T12:00:00Z`))).toBe(week);
    }
  });
});
