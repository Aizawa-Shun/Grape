import type { CheerioAPI } from "cheerio";

/**
 * Machine-readable descriptions of a product that survive client-side
 * rendering.
 *
 * A single-page app serves an empty body, but the same page usually still
 * carries a PWA manifest and sometimes JSON-LD — both are static files or
 * static markup, both are written to describe the product to other software,
 * and both are exactly the What we would otherwise be missing. Reading them
 * costs one extra request and no browser, so it happens on every crawl rather
 * than only on the fallback path.
 *
 * Everything here lands in `CrawledPage.meta` under a prefix (`manifest:`,
 * `ld:`) so the extraction prompt can tell a machine-readable claim from the
 * page's own visible copy.
 */

/** Fields worth carrying into a Product Context; the rest is plumbing. */
const JSON_LD_FIELDS = [
  "name",
  "alternateName",
  "description",
  "headline",
  "slogan",
  "abstract",
  "applicationCategory",
  "applicationSubCategory",
  "audience",
  "featureList",
] as const;

const MANIFEST_FIELDS = ["name", "short_name", "description", "categories", "lang"] as const;

/** Guards against a hostile or merely enormous manifest filling the prompt. */
const MAX_VALUE_CHARS = 2_000;

export function findManifestUrl($: CheerioAPI, pageUrl: string): string | null {
  const href = $('link[rel~="manifest"]').first().attr("href");
  if (!href) return null;
  try {
    return new URL(href, pageUrl).toString();
  } catch {
    return null;
  }
}

/**
 * W3C Web App Manifest. `name` and `description` are written for an install
 * prompt, so they tend to be the plainest one-line statement of what the thing
 * is that exists anywhere on the site.
 */
export function manifestToMeta(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};

  const out: Record<string, string> = {};
  for (const field of MANIFEST_FIELDS) {
    const value = stringify(raw[field]);
    if (value) out[`manifest:${field}`] = value;
  }
  return out;
}

/**
 * Reads `<script type="application/ld+json">`. Must run before the caller
 * strips script tags for text extraction.
 */
export function jsonLdToMeta($: CheerioAPI): Record<string, string> {
  const out: Record<string, string> = {};

  $('script[type="application/ld+json"]').each((_, element) => {
    const parsed = parseJson($(element).text());
    if (parsed === undefined) return;

    for (const node of flattenGraph(parsed)) {
      for (const field of JSON_LD_FIELDS) {
        const value = stringify(node[field]);
        // First occurrence wins: the top-level entity is emitted before the
        // nested ones it links to, and it is the one describing the product.
        if (value && !out[`ld:${field}`]) out[`ld:${field}`] = value;
      }
    }
  });

  return out;
}

/** JSON-LD arrives as an object, an array of them, or an `@graph` wrapper. */
function flattenGraph(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenGraph);
  if (!isRecord(value)) return [];
  const graph = value["@graph"];
  return graph ? [value, ...flattenGraph(graph)] : [value];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Hand-written JSON-LD is frequently malformed; a broken block is simply
    // not a source of evidence.
    return undefined;
  }
}

/** Flattens the scalar-or-list-or-nested-thing shapes these formats allow. */
function stringify(value: unknown): string | null {
  if (typeof value === "string") return clamp(value.trim());
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(stringify).filter((part): part is string => Boolean(part));
    return parts.length ? clamp(parts.join(", ")) : null;
  }
  if (isRecord(value)) {
    // e.g. `audience: { audienceType: "developers" }`, `name: { "@value": … }`.
    const inner = value["@value"] ?? value.name ?? value.audienceType ?? value.description;
    return inner === undefined ? null : stringify(inner);
  }
  return null;
}

function clamp(value: string): string | null {
  if (!value) return null;
  return value.length > MAX_VALUE_CHARS ? value.slice(0, MAX_VALUE_CHARS) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
