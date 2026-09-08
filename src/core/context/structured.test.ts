import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";

import { findManifestUrl, jsonLdToMeta, manifestToMeta } from "./structured";

function load(html: string) {
  return cheerio.load(html);
}

function ldScript(payload: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

describe("manifestToMeta", () => {
  it("keeps the fields that describe the product and drops the rest", () => {
    const meta = manifestToMeta({
      name: "Cheeeess",
      short_name: "Chess",
      description: "オンラインチェスアプリ",
      lang: "ja",
      categories: ["games", "board"],
      theme_color: "#000000",
      icons: [{ src: "/icon.png" }],
    });

    expect(meta).toEqual({
      "manifest:name": "Cheeeess",
      "manifest:short_name": "Chess",
      "manifest:description": "オンラインチェスアプリ",
      "manifest:lang": "ja",
      "manifest:categories": "games, board",
    });
  });

  it("returns nothing for a body that is not a manifest object", () => {
    expect(manifestToMeta("<html></html>")).toEqual({});
    expect(manifestToMeta(null)).toEqual({});
    expect(manifestToMeta([1, 2, 3])).toEqual({});
  });
});

describe("jsonLdToMeta", () => {
  it("reads a plain entity", () => {
    const $ = load(
      ldScript({
        "@type": "SoftwareApplication",
        name: "Grape",
        description: "個人開発者向けの growth OS",
        applicationCategory: "BusinessApplication",
      }),
    );

    expect(jsonLdToMeta($)).toEqual({
      "ld:name": "Grape",
      "ld:description": "個人開発者向けの growth OS",
      "ld:applicationCategory": "BusinessApplication",
    });
  });

  it("walks an @graph and prefers the entity declared first", () => {
    const $ = load(
      ldScript({
        "@graph": [
          { "@type": "WebSite", name: "Grape" },
          { "@type": "Organization", name: "Grape Inc" },
        ],
      }),
    );

    expect(jsonLdToMeta($)["ld:name"]).toBe("Grape");
  });

  it("flattens the list and nested-object shapes the format allows", () => {
    const $ = load(
      ldScript({
        featureList: ["診断", "タスク生成"],
        audience: { "@type": "Audience", audienceType: "個人開発者" },
        name: { "@value": "Grape" },
      }),
    );

    const meta = jsonLdToMeta($);
    expect(meta["ld:featureList"]).toBe("診断, タスク生成");
    expect(meta["ld:audience"]).toBe("個人開発者");
    expect(meta["ld:name"]).toBe("Grape");
  });

  it("skips a malformed block instead of failing the parse", () => {
    const $ = load(
      `<script type="application/ld+json">{ not json </script>` +
        ldScript({ name: "Grape" }),
    );

    expect(jsonLdToMeta($)).toEqual({ "ld:name": "Grape" });
  });

  it("finds nothing when there is nothing to find", () => {
    expect(jsonLdToMeta(load("<body>plain</body>"))).toEqual({});
  });
});

describe("findManifestUrl", () => {
  it("resolves the manifest link against the page", () => {
    const $ = load('<link rel="manifest" href="/manifest.json">');
    expect(findManifestUrl($, "https://example.com/about")).toBe("https://example.com/manifest.json");
  });

  it("returns null when the page declares no manifest", () => {
    expect(findManifestUrl(load("<head></head>"), "https://example.com/")).toBeNull();
  });
});
