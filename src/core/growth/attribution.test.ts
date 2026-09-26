import { describe, expect, it } from "vitest";

import { attributePosts, countGoal, type EventConfig } from "./attribution";
import { buildFunnel, funnelRows } from "./measurement";

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 0, minutes));
const config: EventConfig = { signup: "signup", activation: "activated", paid: "purchase" };

describe("attributePosts", () => {
  const events = [
    { anonId: "a", sessionId: "s1", name: "pageview", utm: { utm_content: "post-1" }, ts: at(0) },
    { anonId: "a", sessionId: "s1", name: "signup", utm: null, ts: at(5) },
    { anonId: "a", sessionId: "s1", name: "activated", utm: null, ts: at(6) },
    { anonId: "a", sessionId: "s2", name: "purchase", utm: null, ts: at(60) },
    { anonId: "b", sessionId: "s3", name: "pageview", utm: { utm_content: "post-1" }, ts: at(1) },
    // Signed up before ever arriving from the post: not the post's signup.
    { anonId: "c", sessionId: "s4", name: "signup", utm: null, ts: at(0) },
    { anonId: "c", sessionId: "s5", name: "pageview", utm: { utm_content: "post-1" }, ts: at(10) },
    { anonId: "d", sessionId: "s6", name: "pageview", utm: { utm_content: "other" }, ts: at(0) },
  ];

  it("follows a visitor from the post through signup, activation and payment", () => {
    expect(attributePosts(events, ["post-1"], config).get("post-1")).toEqual({ visits: 3, visitors: 3, signups: 1, activations: 1, paid: 1 });
  });

  it("counts nothing for a stage whose event is not named", () => {
    const a = attributePosts(events, ["post-1"], { signup: null, activation: null, paid: null }).get("post-1")!;
    expect([a.signups, a.activations, a.paid]).toEqual([0, 0, 0]);
  });
});

describe("countGoal", () => {
  const events = [
    { anonId: "a", name: "pageview" },
    { anonId: "a", name: "signup" },
    { anonId: "a", name: "signup" },
    { anonId: "b", name: "pageview" },
    { anonId: "b", name: "purchase" },
  ];

  it("counts distinct people, for the event the metric names", () => {
    expect(countGoal(events, { metric: "signups" }, config)).toBe(1);
    expect(countGoal(events, { metric: "paid" }, config)).toBe(1);
    expect(countGoal(events, { metric: "visitors" }, config)).toBe(2);
  });
});

describe("the measurement funnel", () => {
  it("keeps 'not measured' apart from zero, all the way to the rows", () => {
    const attribution = new Map([["p", { visits: 4, visitors: 4, signups: 1, activations: 0, paid: 0 }]]);
    const funnel = buildFunnel([{ id: "p", metrics: null }], attribution, { signup: "signup", activation: null, paid: null });
    expect(funnel).toMatchObject({ impressions: null, engagements: null, websiteVisitors: 4, signups: 1, activations: null, paid: null });
    const rows = funnelRows(funnel);
    expect(rows.find((r) => r.key === "impressions")?.missing).toContain("Xの数字");
    expect(rows.find((r) => r.key === "signups")?.rate).toEqual({ label: "訪問から", value: 0.25 });
    expect(rows.find((r) => r.key === "paid")?.missing).toContain("課金");
  });
});
