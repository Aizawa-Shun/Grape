import * as cheerio from "cheerio";

import { AppError } from "@/core/errors";
import {
  isPrivateHost,
  policyForEntry,
  safeFetch,
  type Lookup,
  type TargetPolicy,
} from "@/core/net/guard";
import { readTextCapped } from "@/core/net/read";
import { log } from "@/server/log";

import { createPageRenderer, type PageRenderer } from "./render";
import { findManifestUrl, jsonLdToMeta, manifestToMeta } from "./structured";

/**
 * The front half of the Product Context Engine: turn a URL into the raw
 * material an extraction prompt can reason over.
 *
 * Reading a page happens in three widening steps, and stops at the first one
 * that yields text:
 *
 *   1. Plain fetch + HTML parse. Covers static and server-rendered sites,
 *      which is most indie landing pages, at no meaningful cost.
 *   2. Machine-readable descriptions on the same markup — JSON-LD and the PWA
 *      manifest. One extra request, no browser, and it survives client-side
 *      rendering because both are static by construction.
 *   3. A headless browser (see `render.ts`), only when steps 1-2 left the page
 *      with no visible text at all. This is the expensive path — ~300 MB of
 *      RAM on an 8 GB machine — so it is reserved for pages that are genuinely
 *      unreadable without it, i.e. client-rendered apps.
 *
 * Step 3 is also what recovers a client-rendered site's navigation: its links
 * do not exist in the served HTML either, so without rendering, the crawl
 * would see a one-page site.
 */

/**
 * One heading and the copy underneath it.
 *
 * `text` alone is a single run of words with every structural boundary
 * collapsed out of it — "Dominion ModeSeize the board.Every move paints…" —
 * which a model can still read but a rule can not. These sections keep the one
 * piece of structure a landing page actually uses to make its argument: a
 * claim as a heading, with its explanation beneath. That is what lets
 * core/context/extract.ts quote the site about who it is for, without a model
 * and without inventing anything.
 */
export interface PageSection {
  /** Heading text, whitespace collapsed. Never empty. */
  heading: string;
  /** 1-3, from h1-h3. Deeper headings are page furniture more often than argument. */
  level: number;
  /** Copy between this heading and the next one. Empty when the markup puts them in separate containers. */
  body: string;
}

export interface CrawledPage {
  url: string;
  status: number;
  title: string | null;
  /** Visible text, tags stripped and whitespace collapsed. */
  text: string;
  /**
   * Page `<meta>` plus, under `manifest:` / `ld:` prefixes, whatever the PWA
   * manifest and JSON-LD claimed. The prefix matters downstream: it separates
   * a machine-readable assertion from the page's own visible copy.
   */
  meta: Record<string, string>;
  /** Headings and the copy under each, in document order. See PageSection. */
  sections: PageSection[];
  /**
   * The labels on buttons and prominent links — "無料で始める", "Book a demo",
   * "Download". A page's calls to action say what it wants the reader to do,
   * which is the most direct statement of its business model anywhere on it:
   * "Start free trial" and "Contact sales" describe two different companies.
   */
  ctas: string[];
  /**
   * Strings that look like prices, in document order. Pulled out rather than
   * left in the body text because they are the one fact about a SaaS that a
   * reader checks first and a model skims past — "$9/mo" is four characters in
   * a thousand-word page.
   */
  prices: string[];
  /** Same-origin links found on this page, absolute and de-duplicated. */
  links: string[];
  /** Which of the three steps above produced `text`. */
  renderedWith: "static" | "browser";
}

export interface CrawlOptions {
  maxPages?: number;
  /** Per-request timeout. */
  timeoutMs?: number;
  /** Cap on stored text per page, so prompts stay bounded. */
  maxTextChars?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /**
   * Set false to keep a crawl strictly static — no browser is launched even
   * for a page that renders nothing. Tests use this; so would a deployment
   * that cannot spare the memory.
   */
  renderClientSide?: boolean;
  /** Injectable for tests, so a fake renderer can stand in for Chromium. */
  rendererFactory?: () => Promise<PageRenderer>;
  /** Injectable for tests, so the private-address guard needs no real DNS. */
  lookup?: Lookup;
}

const DEFAULTS = {
  // Raised from 5 once extraction stopped being a single model call over the
  // entry page: the rule-based reading quotes whichever page actually states
  // who the product is for, and those are exactly the /about, /pricing and
  // /features pages that a 5-page budget spent on the nav never reached.
  // Costs a few seconds per extra page and nothing else — registration is
  // already a deliberate, one-off wait with its own progress indicator.
  maxPages: 8,
  timeoutMs: 15_000,
  maxTextChars: 20_000,
  /**
   * The timeout bounds how long a fetch may take, not how much it may send.
   * Without a ceiling a fast server can push far more into memory than this
   * machine has, well inside 15 seconds.
   */
  maxHtmlBytes: 2 * 1024 * 1024,
  maxManifestBytes: 256 * 1024,
} as const;

const USER_AGENT = "GrapeBot/0.1 (+https://github.com/; indie product growth assistant)";

/**
 * Paths that usually carry the value proposition, most valuable first.
 * Crawling is capped at a handful of pages, so spend them on the pages most
 * likely to say what the product is, rather than on whatever the nav happens
 * to list first.
 *
 * The order is the order the analysis needs answers in: what it is and who for
 * (about/features), then what it costs (pricing), then the long tail that only
 * fills gaps (faq, docs, contact).
 */
const PRIORITY_PATTERNS = [
  /^\/?$/,
  /^\/(about|company|what|why)/i,
  /^\/(features?|product|solutions?|use-?cases?|tour)/i,
  /^\/(pricing|plans?|price)/i,
  /^\/(faq|help|support)/i,
  /^\/(docs?|documentation|guide|getting-?started)/i,
  /^\/(contact|sales|demo)/i,
];

const SKIP_EXTENSIONS =
  /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|json|xml|txt|pdf|zip|gz|mp4|webm|mp3|woff2?|ttf|eot)$/i;

export function normalizeUrl(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    // Trailing slash on the root only; "/a" and "/a/" are the same page often
    // enough that crawling both wastes one of our few page budget slots.
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function priorityOf(url: string): number {
  const { pathname } = new URL(url);
  const index = PRIORITY_PATTERNS.findIndex((pattern) => pattern.test(pathname));
  return index === -1 ? PRIORITY_PATTERNS.length : index;
}

export type ParsedPage = Omit<CrawledPage, "status" | "renderedWith"> & {
  /** Absolute URL of `<link rel="manifest">`, for the caller to fetch. */
  manifestUrl: string | null;
};

export function parseHtml(html: string, pageUrl: string, maxTextChars: number): ParsedPage {
  const $ = cheerio.load(html);

  // Both of these read markup that the text pass is about to delete, so they
  // run first.
  const manifestUrl = findManifestUrl($, pageUrl);
  const structuredMeta = jsonLdToMeta($);

  $("script, style, noscript, svg, template, iframe").remove();

  const meta: Record<string, string> = { ...structuredMeta };
  $("meta").each((_, element) => {
    const key = $(element).attr("name") ?? $(element).attr("property");
    const value = $(element).attr("content");
    if (key && value) meta[key.toLowerCase()] = value;
  });

  // The language the document claims for itself. Evidence for the Context's
  // primaryLanguage, and the locale the browser fallback renders under.
  const declaredLang = $("html").attr("lang")?.trim();
  if (declaredLang) meta["html:lang"] = declaredLang;

  const origin = new URL(pageUrl).origin;
  const links = new Set<string>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    const absolute = normalizeUrl(href, pageUrl);
    if (!absolute) return;
    if (new URL(absolute).origin !== origin) return;
    if (SKIP_EXTENSIONS.test(new URL(absolute).pathname)) return;
    links.add(absolute);
  });

  const title = $("title").first().text().trim() || null;
  const headingSections = extractSections($);
  const ctas = extractCtas($);
  // Last, because it rewrites the DOM to recover line breaks — everything
  // above reads the markup as served.
  const text = visibleText($, maxTextChars);

  return {
    url: pageUrl,
    title,
    text,
    meta,
    sections: headingSections.length > 0 ? headingSections : sectionsFromLines(text),
    ctas,
    prices: extractPrices(text),
    links: [...links],
    manifestUrl,
  };
}

/** Enough to cover a long landing page; past this a document is a listing, not an argument. */
const MAX_SECTIONS = 60;
/** A section body is a paragraph or two of supporting copy — anything longer is the rest of the page leaking in. */
const MAX_SECTION_BODY_CHARS = 600;

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Enough to characterise what a page asks of its reader; more than this is a nav bar. */
const MAX_CTAS = 12;
/** A call to action is a few words on a button, not a paragraph that happens to be clickable. */
const MAX_CTA_CHARS = 40;
const MAX_PRICES = 12;

/**
 * Button and prominent-link labels, de-duplicated in document order.
 *
 * Deliberately not every `<a>`: a nav bar would drown the handful of labels
 * that mean something. Buttons, submits and anything explicitly given a button
 * role are what a page uses for the action it actually wants.
 */
function extractCtas($: cheerio.CheerioAPI): string[] {
  const found = new Set<string>();

  $("button, [role='button'], input[type='submit'], a[class*='button'], a[class*='btn'], a[class*='cta']").each(
    (_, element) => {
      if (found.size >= MAX_CTAS) return false;

      const node = $(element);
      const label = collapse(node.attr("value") ?? node.text() ?? "");
      if (label && label.length <= MAX_CTA_CHARS) found.add(label);
    },
  );

  return [...found];
}

/**
 * Price-shaped strings: a currency marker next to a number, or a Japanese
 * amount, plus the per-period suffix when one follows.
 *
 * Loose on purpose. A false positive costs a line in a prompt; a miss costs
 * the pricing answer entirely, and pricing is the single most-checked fact
 * about a SaaS.
 */
const PRICE_PATTERN =
  /(?:[$€£¥]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*\s?円|\d[\d,]*\s?ドル)(?:\s?\/\s?(?:mo|month|yr|year|月|年|人|seat|user))?/gi;

function extractPrices(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PRICE_PATTERN)) {
    found.add(collapse(match[0]));
    if (found.size >= MAX_PRICES) break;
  }
  return [...found];
}

/** Elements that end a line when a reader looks at the page, whatever the markup does about it. */
const BLOCK_ELEMENTS =
  "p, div, section, article, aside, header, footer, main, nav, li, dt, dd, tr, h1, h2, h3, h4, h5, h6, blockquote, figcaption, pre, hr, table, form, label, button";

/**
 * The visible copy, with the line breaks a reader sees.
 *
 * `$("body").text()` concatenates every text node with nothing between them,
 * so a page whose pitch reads
 *
 *     CHEEEESS
 *     Chess, but bigger.
 *     An 8×16 board. New space. New strategy.
 *
 * arrives as `CHEEEESSChess, but bigger.An 8×16 board…` — one run of words
 * with every boundary between a claim and its explanation erased. A model can
 * still read that; a rule cannot, and neither can a person looking at the
 * crawled-pages screen. Appending a newline to each block element before
 * flattening recovers exactly the structure that was thrown away, which is
 * what makes sectionsFromLines possible on a site built entirely from divs.
 *
 * Destructive to the DOM, so it runs last in parseHtml.
 */
function visibleText($: cheerio.CheerioAPI, maxChars: number): string {
  $("br").replaceWith("\n");
  $(BLOCK_ELEMENTS).each((_, element) => {
    $(element).append("\n");
  });

  return $("body")
    .text()
    // Horizontal whitespace only — collapsing \s+ here would undo the above.
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxChars);
}

/**
 * The one threshold this guess turns on: at or above it a line is a sentence
 * explaining something, below it a heading, a nav item or a button. Sorting
 * every line into one of those two piles is what stands in for the heading
 * markup the page never used.
 */
const BODY_MIN_CHARS = 40;
/** How many short lines above a sentence still count as its heading. */
const MAX_HEADING_LINES = 2;

/**
 * Sections for a page with no heading markup at all.
 *
 * Plenty of sites are built entirely from styled `<div>`s — the h1/h2 that
 * extractSections looks for never appear, and cheeeess.com is one of them.
 * What such a page still has is shape: a short line making a claim, then a
 * sentence explaining it. That is the same structure a heading encodes, just
 * expressed in font size instead of markup, and it is recoverable from the
 * line breaks visibleText restores.
 *
 * A guess, unlike extractSections, which is why headings win when they exist.
 * The quoted text is still only ever the page's own — see the note
 * core/context/extract.ts attaches to everything built from these.
 */
function sectionsFromLines(text: string): PageSection[] {
  const sections: PageSection[] = [];
  let pending: string[] = [];

  for (const line of text.split("\n")) {
    if (line.length < BODY_MIN_CHARS) {
      pending.push(line);
      if (pending.length > MAX_HEADING_LINES) pending.shift();
      continue;
    }

    // A sentence: it explains whichever short lines led up to it.
    if (pending.length > 0) {
      sections.push({
        heading: pending.join(" "),
        // Always 2: without markup there is no depth to report, and 1 would
        // claim this is the page's h1, which nothing here established.
        level: 2,
        body: line.slice(0, MAX_SECTION_BODY_CHARS),
      });
      pending = [];
      if (sections.length >= MAX_SECTIONS) break;
    }
  }

  return sections;
}

/**
 * `nextUntil` rather than a full document walk: a heading's explanation is
 * normally its own next sibling, and the cases where it is not — heading and
 * copy in separate wrapper divs — still leave the heading itself, which is the
 * half that carries the claim. An empty body is therefore a recorded outcome,
 * not a failure to handle.
 */
function extractSections($: cheerio.CheerioAPI): PageSection[] {
  const sections: PageSection[] = [];

  $("h1, h2, h3").each((_, element) => {
    if (sections.length >= MAX_SECTIONS) return false;

    const node = $(element);
    const heading = collapse(node.text());
    if (!heading) return;

    sections.push({
      heading,
      level: Number(element.tagName.slice(1)),
      body: collapse(node.nextUntil("h1, h2, h3").text()).slice(0, MAX_SECTION_BODY_CHARS),
    });
  });

  return sections;
}

interface FetchSettings {
  timeoutMs: number;
  maxTextChars: number;
  fetchImpl: typeof fetch;
  policy: TargetPolicy;
}

/**
 * `isHtml` decides whether the browser fallback is even worth trying. A JSON
 * or PDF response is not an unrendered page — it is simply not a page, and
 * launching Chromium at it would burn seconds to learn nothing.
 */
interface FetchedPage {
  page: CrawledPage;
  isHtml: boolean;
}

async function fetchPage(url: string, options: FetchSettings): Promise<FetchedPage> {
  try {
    const { response, finalUrl } = await safeFetch(
      url,
      { headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" } },
      { policy: options.policy, timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl },
    );

    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("html")) {
      return { page: unreadable(url, response.status), isHtml: false };
    }

    const { text: html } = await readTextCapped(response, DEFAULTS.maxHtmlBytes);
    // Parsed against finalUrl, not url: after a redirect the relative links on
    // the page belong to where it ended up, not where it was asked for.
    const parsed = parseHtml(html, finalUrl, options.maxTextChars);
    // Recorded under where it actually ended up, so a redirect target cannot
    // later be queued again as if it were a page we had not read.
    const page = await toCrawledPage(parsed, response.status, "static", options);
    return { page, isHtml: true };
  } catch (error) {
    // A page that times out or refuses connection is a data point, not a crash:
    // the crawl continues and the diagnosis sees an unreachable page.
    const name = error instanceof Error ? error.name : "";
    const status = name === "TimeoutError" || name === "AbortError" ? 408 : 0;
    return { page: unreadable(url, status), isHtml: false };
  }
}

function unreadable(url: string, status: number): CrawledPage {
  return {
    url,
    status,
    title: null,
    text: "",
    meta: {},
    sections: [],
    ctas: [],
    prices: [],
    links: [],
    renderedWith: "static",
  };
}

async function toCrawledPage(
  parsed: ParsedPage,
  status: number,
  renderedWith: CrawledPage["renderedWith"],
  options: FetchSettings,
): Promise<CrawledPage> {
  const { manifestUrl, ...page } = parsed;
  const manifest = manifestUrl ? await fetchManifest(manifestUrl, options) : {};
  return { ...page, status, renderedWith, meta: { ...page.meta, ...manifest } };
}

async function fetchManifest(url: string, options: FetchSettings): Promise<Record<string, string>> {
  try {
    const { response } = await safeFetch(
      url,
      { headers: { "user-agent": USER_AGENT, accept: "application/manifest+json,application/json" } },
      { policy: options.policy, timeoutMs: options.timeoutMs, fetchImpl: options.fetchImpl },
    );
    if (!response.ok) return {};

    // A single-page app answers every unknown path with its HTML shell, so a
    // 200 here proves nothing — only parseable JSON does.
    const { text } = await readTextCapped(response, DEFAULTS.maxManifestBytes);
    return manifestToMeta(JSON.parse(text));
  } catch {
    return {};
  }
}

/**
 * Fetches the entry page, then spends the remaining page budget on the
 * highest-priority same-origin links it found. Sequential on purpose — this is
 * someone's small site, and a burst of parallel requests is rude for no gain at
 * this page count.
 */
export async function crawlSite(startUrl: string, options: CrawlOptions = {}): Promise<CrawledPage[]> {
  const maxPages = options.maxPages ?? DEFAULTS.maxPages;
  const renderClientSide = options.renderClientSide ?? true;

  const entry = normalizeUrl(startUrl);
  if (!entry) throw new AppError("INVALID_INPUT", `Not a crawlable URL: ${startUrl}`);

  const policy = policyForEntry(entry, options.lookup);
  if (isPrivateHost(policy.entryHost)) {
    // Allowed — someone pointing Grape at their own dev server is a real use
    // case — but worth a line in the log, because from here on this crawl is
    // touching the machine it runs on.
    log.warn("crawl.private_entry", { host: policy.entryHost });
  }

  const settings: FetchSettings = {
    timeoutMs: options.timeoutMs ?? DEFAULTS.timeoutMs,
    maxTextChars: options.maxTextChars ?? DEFAULTS.maxTextChars,
    fetchImpl: options.fetchImpl ?? fetch,
    policy,
  };

  const renderer = lazyRenderer(options.rendererFactory ?? createPageRenderer);

  const readPage = async (url: string): Promise<CrawledPage> => {
    const { page, isHtml } = await fetchPage(url, settings);
    // Render only an HTML page that came back empty — that is the client-side
    // rendering signature. Anything else has nothing for a browser to add.
    if (!renderClientSide || !isHtml || page.text.length > 0) return page;
    return (await renderPage(url, page)) ?? page;
  };

  const renderPage = async (url: string, staticPage: CrawledPage): Promise<CrawledPage | null> => {
    const rendered = await (await renderer.get()).render(url, {
      // The shell that rendered nothing still declared its language, in
      // `<html lang>` or its manifest. Render as that audience sees it.
      locale: staticPage.meta["html:lang"] ?? staticPage.meta["manifest:lang"] ?? null,
    });
    if (!rendered) return null;

    const { manifestUrl: _ignored, ...parsed } = parseHtml(rendered.html, url, settings.maxTextChars);
    if (parsed.text.length === 0) return null;

    return {
      ...parsed,
      status: rendered.status,
      renderedWith: "browser",
      // The static pass already resolved the manifest; rendering can only add
      // to that (a client-side router rewrites title and og: tags after mount),
      // so later values win but nothing is dropped.
      meta: { ...staticPage.meta, ...parsed.meta },
    };
  };

  try {
    const seen = new Set<string>([entry]);
    const pages: CrawledPage[] = [await readPage(entry)];
    seen.add(pages[0].url);

    const queue = pages[0].links
      .filter((link) => !seen.has(link))
      .sort((a, b) => priorityOf(a) - priorityOf(b));

    for (const link of queue) {
      if (pages.length >= maxPages) break;
      if (seen.has(link)) continue;
      seen.add(link);
      const page = await readPage(link);
      seen.add(page.url);
      pages.push(page);
    }

    return pages;
  } finally {
    await renderer.close();
  }
}

/**
 * Defers the browser launch until a page actually needs rendering, and keeps
 * the one instance for the rest of the crawl. A site that needs rendering for
 * its entry page needs it for every page; a site that does not must never pay
 * for a launch at all.
 */
function lazyRenderer(factory: () => Promise<PageRenderer>) {
  let instance: Promise<PageRenderer> | null = null;
  return {
    get(): Promise<PageRenderer> {
      return (instance ??= factory());
    },
    async close(): Promise<void> {
      const started = instance;
      if (started) await (await started).close();
    },
  };
}
