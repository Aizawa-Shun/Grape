import { describe, expect, it } from "vitest";

import type { CrawledPage } from "@/core/context/crawl";
import { UNSTATED } from "@/core/context/extract";

import { runSiteAudit, type AuditContextInput } from "./audit";

function page(overrides: Partial<CrawledPage> = {}): CrawledPage {
  return {
    url: "https://example.com/",
    status: 200,
    title: "Example",
    text: "",
    meta: {},
    links: [],
    renderedWith: "static",
    ...overrides,
  };
}

const STATED_CONTEXT: AuditContextInput = {
  what: "個人開発者向けのタスク管理アプリ",
  who: "個人開発者",
  gaps: [],
};

const UNSTATED_CONTEXT: AuditContextInput = {
  what: UNSTATED,
  who: UNSTATED,
  gaps: ["誰向けか明示されていない"],
};

function findingFor(findings: ReturnType<typeof runSiteAudit>, check: string) {
  const found = findings.find((f) => f.check === check);
  if (!found) throw new Error(`no finding for ${check}`);
  return found;
}

describe("runSiteAudit", () => {
  it("passes value_proposition when the Context has both What and Who", () => {
    const findings = runSiteAudit([page()], STATED_CONTEXT);
    expect(findingFor(findings, "value_proposition").passed).toBe(true);
  });

  it("fails value_proposition when extraction could not state What or Who", () => {
    const findings = runSiteAudit([page()], UNSTATED_CONTEXT);
    const finding = findingFor(findings, "value_proposition");
    expect(finding.passed).toBe(false);
    expect(finding.detail).toContain("誰向けか明示されていない");
  });

  it("passes meta_description from a plain description, OGP, or the manifest", () => {
    expect(
      findingFor(runSiteAudit([page({ meta: { description: "x" } })], STATED_CONTEXT), "meta_description")
        .passed,
    ).toBe(true);
    expect(
      findingFor(
        runSiteAudit([page({ meta: { "og:description": "x" } })], STATED_CONTEXT),
        "meta_description",
      ).passed,
    ).toBe(true);
    expect(
      findingFor(
        runSiteAudit([page({ meta: { "manifest:description": "x" } })], STATED_CONTEXT),
        "meta_description",
      ).passed,
    ).toBe(true);
  });

  it("fails meta_description when no page has any of them", () => {
    expect(findingFor(runSiteAudit([page()], STATED_CONTEXT), "meta_description").passed).toBe(false);
  });

  it("passes viewport only when a page declares one", () => {
    expect(findingFor(runSiteAudit([page()], STATED_CONTEXT), "viewport").passed).toBe(false);
    expect(
      findingFor(
        runSiteAudit([page({ meta: { viewport: "width=device-width" } })], STATED_CONTEXT),
        "viewport",
      ).passed,
    ).toBe(true);
  });

  it("recognises Japanese and English call-to-action phrasing", () => {
    expect(
      findingFor(runSiteAudit([page({ text: "無料で始める" })], STATED_CONTEXT), "call_to_action").passed,
    ).toBe(true);
    expect(
      findingFor(runSiteAudit([page({ text: "Get started for free" })], STATED_CONTEXT), "call_to_action")
        .passed,
    ).toBe(true);
  });

  it("fails call_to_action when the copy never asks for anything", () => {
    expect(
      findingFor(runSiteAudit([page({ text: "これは製品の説明文です。" })], STATED_CONTEXT), "call_to_action")
        .passed,
    ).toBe(false);
  });

  it("flags js_rendering when any page needed the browser fallback to read", () => {
    const findings = runSiteAudit([page({ renderedWith: "browser" })], STATED_CONTEXT);
    const finding = findingFor(findings, "js_rendering");
    expect(finding.passed).toBe(false);
    expect(finding.detail).toContain("example.com");
  });

  it("passes js_rendering when every page's body arrived without a browser", () => {
    expect(findingFor(runSiteAudit([page()], STATED_CONTEXT), "js_rendering").passed).toBe(true);
  });

  it("ignores unreachable pages for the HTML-derived checks", () => {
    const findings = runSiteAudit(
      [page({ status: 404, meta: { description: "x" }, text: "無料" })],
      STATED_CONTEXT,
    );
    expect(findingFor(findings, "meta_description").passed).toBe(false);
    expect(findingFor(findings, "call_to_action").passed).toBe(false);
  });
});
