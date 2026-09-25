import { describe, expect, it } from "vitest";

import { attributePosts, countGoal } from "./attribution";

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 1, 0, minutes));

describe("attributePosts", () => {
  it("counts sessions from a post and the visitors who later signed up", () => {
    const events = [
      { anonId: "a", sessionId: "s1", name: "pageview", utm: { utm_content: "post-1" }, ts: at(0) },
      { anonId: "a", sessionId: "s1", name: "signup", utm: null, ts: at(5) },
      { anonId: "b", sessionId: "s2", name: "pageview", utm: { utm_content: "post-1" }, ts: at(1) },
      // Signed up before ever arriving from the post: not the post's signup.
      { anonId: "c", sessionId: "s3", name: "signup", utm: null, ts: at(0) },
      { anonId: "c", sessionId: "s4", name: "pageview", utm: { utm_content: "post-1" }, ts: at(10) },
      { anonId: "d", sessionId: "s5", name: "pageview", utm: { utm_content: "other" }, ts: at(0) },
    ];
    const result = attributePosts(events, ["post-1"], "signup");
    expect(result.get("post-1")).toEqual({ visits: 3, visitors: 3, signups: 1 });
  });

  it("counts no signups when there is no key event", () => {
    const events = [{ anonId: "a", sessionId: "s1", name: "pageview", utm: { utm_content: "p" }, ts: at(0) }];
    expect(attributePosts(events, ["p"], null).get("p")!.signups).toBe(0);
  });
});

describe("countGoal", () => {
  const events = [
    { anonId: "a", name: "pageview" },
    { anonId: "a", name: "signup" },
    { anonId: "a", name: "signup" },
    { anonId: "b", name: "pageview" },
  ];

  it("counts distinct people, not events", () => {
    expect(countGoal(events, { metric: "signups" }, "signup")).toBe(1);
    expect(countGoal(events, { metric: "visitors" }, "signup")).toBe(2);
  });
});
