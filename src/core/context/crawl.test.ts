import { describe, expect, it } from "vitest";

import { crawlSite, normalizeUrl, parseHtml } from "./crawl";
import type { PageRenderer } from "./render";

function htmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** A fake site plus a record of which pages were actually requested. */
function fakeSite(pages: Record<string, string>) {
  const requested: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    requested.push(url);
    const body = pages[url];
    if (body === undefined) return new Response("nope", { status: 404 });
    const contentType = url.endsWith(".json")
      ? "application/manifest+json"
      : "text/html; charset=utf-8";
    return new Response(body, { status: 200, headers: { "content-type": contentType } });
  }) as unknown as typeof fetch;
  return { fetchImpl, requested };
}

/**
 * Launching real Chromium inside a unit test would be slow enough to look like
 * a hang, so every crawl test supplies a renderer. This one fails loudly if a
 * test reaches the browser path without meaning to.
 */
function neverRender(): () => Promise<PageRenderer> {
  return async () => ({
    async render() {
      throw new Error("the browser fallback should not have been reached");
    },
    async close() {},
  });
}

/** Stands in for Chromium: serves post-render HTML and counts the calls. */
function fakeRenderer(rendered: Record<string, string>) {
  const renderedUrls: string[] = [];
  const locales: (string | null | undefined)[] = [];
  let launches = 0;
  const rendererFactory = async (): Promise<PageRenderer> => {
    launches += 1;
    return {
      async render(url, options) {
        renderedUrls.push(url);
        locales.push(options?.locale);
        const html = rendered[url];
        return html === undefined ? null : { html, status: 200 };
      },
      async close() {},
    };
  };
  return { rendererFactory, renderedUrls, locales, launches: () => launches };
}

describe("normalizeUrl", () => {
  it("drops the fragment and the trailing slash on non-root paths", () => {
    expect(normalizeUrl("https://example.com/about/#team")).toBe("https://example.com/about");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("resolves relative links against the page they came from", () => {
    expect(normalizeUrl("../pricing", "https://example.com/docs/intro")).toBe(
      "https://example.com/pricing",
    );
  });

  it("rejects non-http schemes", () => {
    expect(normalizeUrl("mailto:hi@example.com")).toBeNull();
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("parseHtml", () => {
  const page = `
    <html>
      <head>
        <title>  Widget  </title>
        <meta name="description" content="A widget for widget people">
        <meta property="og:title" content="Widget OG">
      </head>
      <body>
        <script>var tracking = 1;</script>
        <style>body { color: red }</style>
        <h1>Widget</h1>
        <p>Ship   faster.</p>
        <a href="/pricing">Pricing</a>
        <a href="https://twitter.com/someone">Twitter</a>
        <a href="/logo.png">Logo</a>
        <a href="mailto:hi@example.com">Mail</a>
      </body>
    </html>`;

  const parsed = parseHtml(page, "https://example.com/", 20_000);

  it("pulls the title and meta tags", () => {
    expect(parsed.title).toBe("Widget");
    expect(parsed.meta.description).toBe("A widget for widget people");
    expect(parsed.meta["og:title"]).toBe("Widget OG");
  });

  it("keeps visible text and drops script and style content", () => {
    expect(parsed.text).toContain("Ship faster.");
    expect(parsed.text).not.toContain("tracking");
    expect(parsed.text).not.toContain("color: red");
  });

  it("keeps only same-origin document links", () => {
    expect(parsed.links).toEqual(["https://example.com/pricing"]);
  });

  it("truncates text to the cap", () => {
    const long = parseHtml(`<body>${"x".repeat(500)}</body>`, "https://example.com/", 100);
    expect(long.text).toHaveLength(100);
  });
});

describe("crawlSite", () => {
  it("spends a limited page budget on the pages most likely to describe the product", async () => {
    const { fetchImpl, requested } = fakeSite({
      "https://example.com/": `<body>
        <a href="/blog/post-1">Blog</a>
        <a href="/contact">Contact</a>
        <a href="/pricing">Pricing</a>
        <a href="/about">About</a>
      </body>`,
      "https://example.com/about": "<body>About us</body>",
      "https://example.com/pricing": "<body>$9/mo</body>",
      "https://example.com/contact": "<body>Contact</body>",
      "https://example.com/blog/post-1": "<body>A post</body>",
    });

    const pages = await crawlSite("https://example.com/", {
      maxPages: 3,
      fetchImpl,
      rendererFactory: neverRender(),
    });

    // /about and /pricing beat /contact and /blog even though they appear later
    // in the document.
    expect(requested).toEqual([
      "https://example.com/",
      "https://example.com/about",
      "https://example.com/pricing",
    ]);
    expect(pages).toHaveLength(3);
    expect(pages[1].text).toBe("About us");
  });

  it("never visits the same page twice", async () => {
    const { fetchImpl, requested } = fakeSite({
      "https://example.com/": `<body>
        <a href="/about">About</a>
        <a href="/about/">About again</a>
        <a href="/about#team">About anchor</a>
      </body>`,
      "https://example.com/about": "<body>About us</body>",
    });

    await crawlSite("https://example.com/", {
      maxPages: 5,
      fetchImpl,
      rendererFactory: neverRender(),
    });

    expect(requested).toEqual(["https://example.com/", "https://example.com/about"]);
  });

  it("records an unreachable page instead of failing the whole crawl", async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://example.com/") {
        return htmlResponse('<body><a href="/about">About</a></body>');
      }
      throw new TypeError("connection refused");
    }) as unknown as typeof fetch;

    const pages = await crawlSite("https://example.com/", {
      maxPages: 2,
      fetchImpl,
      rendererFactory: neverRender(),
    });

    expect(pages).toHaveLength(2);
    expect(pages[1].status).toBe(0);
    expect(pages[1].text).toBe("");
  });

  it("ignores non-HTML responses", async () => {
    const fetchImpl = (async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    // A JSON body is empty of *page* text, but it is not an unrendered page —
    // reaching for the browser here would cost seconds and learn nothing.
    const pages = await crawlSite("https://example.com/", {
      fetchImpl,
      rendererFactory: neverRender(),
    });

    expect(pages[0].text).toBe("");
    expect(pages[0].links).toEqual([]);
  });

  it("resolves links against where a redirect landed, not where it was aimed", async () => {
    // A site that sends "/" to "/en/" used to produce links pointing at the
    // wrong paths, because the HTML was parsed against the requested URL.
    const fetchImpl = (async (url: string) => {
      if (url === "https://example.com/") {
        return new Response(null, { status: 302, headers: { location: "/en/" } });
      }
      if (url === "https://example.com/en/") {
        return new Response('<body><a href="about">About</a></body>', {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("<body>About page</body>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }) as unknown as typeof fetch;

    const pages = await crawlSite("https://example.com/", {
      maxPages: 2,
      fetchImpl,
      rendererFactory: neverRender(),
    });

    expect(pages[0].links).toContain("https://example.com/en/about");
  });

  it("refuses a link that leaves the site for a private address", async () => {
    const fetchImpl = (async () =>
      new Response('<body><a href="http://169.254.169.254/">x</a></body>', {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    const pages = await crawlSite("https://example.com/", {
      maxPages: 3,
      fetchImpl,
      lookup: async () => ["127.0.0.1"],
      rendererFactory: neverRender(),
    });

    // Cross-origin links are dropped before this point anyway; what matters is
    // that the crawl completed rather than reaching inward.
    expect(pages).toHaveLength(1);
    expect(pages[0].links).toEqual([]);
  });

  it("rejects a URL it cannot crawl", async () => {
    await expect(crawlSite("not a url")).rejects.toThrow(/not a crawlable url/i);
  });
});

/**
 * The client-rendered path. A single-page app serves a shell with no copy in
 * it and no links either, so without these steps the crawl reports a working
 * product as a blank one-page site.
 */
describe("crawlSite on a client-rendered site", () => {
  const SHELL = `<html><head>
      <link rel="manifest" href="/manifest.json">
    </head><body><div id="root"></div></body></html>`;

  it("reads the PWA manifest even when the body renders nothing", async () => {
    const { fetchImpl } = fakeSite({
      "https://example.com/": SHELL,
      "https://example.com/manifest.json": JSON.stringify({
        name: "Cheeeess",
        description: "オンラインチェスアプリ",
        lang: "ja",
      }),
    });

    const pages = await crawlSite("https://example.com/", {
      fetchImpl,
      renderClientSide: false,
    });

    expect(pages[0].meta["manifest:name"]).toBe("Cheeeess");
    expect(pages[0].meta["manifest:description"]).toBe("オンラインチェスアプリ");
    expect(pages[0].meta["manifest:lang"]).toBe("ja");
  });

  it("falls back to the browser and keeps what the static pass already found", async () => {
    const { fetchImpl } = fakeSite({
      "https://example.com/": SHELL,
      "https://example.com/manifest.json": JSON.stringify({ name: "Cheeeess" }),
    });
    const { rendererFactory, renderedUrls } = fakeRenderer({
      "https://example.com/": "<body><h1>オンラインでチェスを指す</h1></body>",
    });

    const pages = await crawlSite("https://example.com/", { fetchImpl, rendererFactory });

    expect(renderedUrls).toEqual(["https://example.com/"]);
    expect(pages[0].renderedWith).toBe("browser");
    expect(pages[0].text).toContain("オンラインでチェスを指す");
    // Rendering replaces the markup, so the manifest read during the static
    // pass has to survive the swap rather than being resolved twice.
    expect(pages[0].meta["manifest:name"]).toBe("Cheeeess");
  });

  it("crawls the links that only exist after rendering", async () => {
    const { fetchImpl } = fakeSite({
      "https://example.com/": SHELL,
      "https://example.com/about": SHELL,
    });
    const { rendererFactory } = fakeRenderer({
      "https://example.com/": '<body><a href="/about">About</a>Home</body>',
      "https://example.com/about": "<body>About the product</body>",
    });

    const pages = await crawlSite("https://example.com/", {
      maxPages: 2,
      fetchImpl,
      rendererFactory,
    });

    expect(pages.map((page) => page.url)).toEqual([
      "https://example.com/",
      "https://example.com/about",
    ]);
    expect(pages[1].text).toBe("About the product");
  });

  it("launches the browser once for the whole crawl, and never for a static site", async () => {
    const clientRendered = fakeSite({
      "https://example.com/": SHELL,
      "https://example.com/about": SHELL,
    });
    const spa = fakeRenderer({
      "https://example.com/": '<body><a href="/about">About</a>Home</body>',
      "https://example.com/about": "<body>About the product</body>",
    });
    await crawlSite("https://example.com/", {
      maxPages: 2,
      fetchImpl: clientRendered.fetchImpl,
      rendererFactory: spa.rendererFactory,
    });
    expect(spa.launches()).toBe(1);

    const staticSite = fakeSite({ "https://example.com/": "<body>Everything is right here</body>" });
    const unused = fakeRenderer({});
    await crawlSite("https://example.com/", {
      fetchImpl: staticSite.fetchImpl,
      rendererFactory: unused.rendererFactory,
    });
    expect(unused.launches()).toBe(0);
  });

  it("keeps the static result when rendering cannot help", async () => {
    const { fetchImpl } = fakeSite({
      "https://example.com/": SHELL,
      "https://example.com/manifest.json": JSON.stringify({ name: "Cheeeess" }),
    });
    // Chromium missing, launch refused, page still empty after hydration —
    // all of these arrive here as "no rendered HTML".
    const { rendererFactory } = fakeRenderer({});

    const pages = await crawlSite("https://example.com/", { fetchImpl, rendererFactory });

    expect(pages[0].renderedWith).toBe("static");
    expect(pages[0].text).toBe("");
    expect(pages[0].meta["manifest:name"]).toBe("Cheeeess");
  });

  it("renders under the language the shell declared for itself", async () => {
    const { fetchImpl } = fakeSite({
      "https://example.com/": '<html lang="ja"><body><div id="root"></div></body></html>',
    });
    const { rendererFactory, locales } = fakeRenderer({
      "https://example.com/": "<body>オンラインでチェスを指す</body>",
    });

    const pages = await crawlSite("https://example.com/", { fetchImpl, rendererFactory });

    expect(locales).toEqual(["ja"]);
    expect(pages[0].meta["html:lang"]).toBe("ja");
  });

  it("falls back to the manifest's language when the markup declares none", async () => {
    const { fetchImpl } = fakeSite({
      "https://example.com/": SHELL,
      "https://example.com/manifest.json": JSON.stringify({ name: "Cheeeess", lang: "ja" }),
    });
    const { rendererFactory, locales } = fakeRenderer({
      "https://example.com/": "<body>オンラインでチェスを指す</body>",
    });

    await crawlSite("https://example.com/", { fetchImpl, rendererFactory });

    expect(locales).toEqual(["ja"]);
  });

  it("does not let a single-page app's catch-all route pass as a manifest", async () => {
    // An SPA answers /manifest.json with its HTML shell and a 200. Believing
    // that would put markup into the evidence the extraction prompt quotes.
    const { fetchImpl } = fakeSite({
      "https://example.com/": SHELL,
      "https://example.com/manifest.json": SHELL,
    });

    const pages = await crawlSite("https://example.com/", {
      fetchImpl,
      renderClientSide: false,
    });

    expect(Object.keys(pages[0].meta).some((key) => key.startsWith("manifest:"))).toBe(false);
  });
});
