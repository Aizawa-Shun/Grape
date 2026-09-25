import { describe, expect, it } from "vitest";

import type { GrowthPolicy } from "@/db/schema";

import { DEFAULT_POLICY, inQuietHours, publishBlockers, tokyoDay } from "./policy";

const policy: GrowthPolicy = { id: "p", productId: "p", updatedAt: new Date(), ...DEFAULT_POLICY, blockKeywords: ["casino"] };
/** 12:00 in Japan. */
const noonJst = new Date("2026-09-01T03:00:00Z");
/** 01:00 in Japan — inside the default 23–7 quiet hours. */
const nightJst = new Date("2026-09-01T16:00:00Z");

describe("inQuietHours", () => {
  it("handles windows that wrap midnight", () => {
    expect(inQuietHours(policy, nightJst)).toBe(true);
    expect(inQuietHours(policy, noonJst)).toBe(false);
  });

  it("treats equal start and end as no quiet hours", () => {
    expect(inQuietHours({ quietHoursStart: 5, quietHoursEnd: 5 }, nightJst)).toBe(false);
  });
});

describe("tokyoDay", () => {
  it("rolls over at midnight in Japan, not UTC", () => {
    expect(tokyoDay(new Date("2026-09-01T15:30:00Z"))).toBe("2026-09-02");
  });
});

describe("publishBlockers", () => {
  const reply = { kind: "reply" as const, text: "役に立つ返信" };

  it("lets a person approve at night, but not the agent", () => {
    expect(publishBlockers(reply, policy, { sentToday: 0, relevance: 90, automatic: false, now: nightJst })).toEqual([]);
    const auto = publishBlockers(reply, { ...policy, approvalMode: "autonomous" }, { sentToday: 0, relevance: 90, automatic: true, now: nightJst });
    expect(auto.join()).toContain("時間帯");
  });

  it("holds a person to the daily limit and the blocked words too", () => {
    const blockers = publishBlockers({ kind: "post", text: "best casino" }, policy, { sentToday: 2, relevance: null, automatic: false, now: noonJst });
    expect(blockers).toHaveLength(2);
  });

  it("refuses to act automatically unless the mode is autonomous", () => {
    expect(publishBlockers(reply, policy, { sentToday: 0, relevance: 95, automatic: true, now: noonJst }).join()).toContain("自動実行はオフ");
  });

  it("holds the agent to the relevance floor on replies", () => {
    const blockers = publishBlockers(reply, { ...policy, approvalMode: "autonomous" }, { sentToday: 0, relevance: 50, automatic: true, now: noonJst });
    expect(blockers.join()).toContain("関連度");
  });
});
