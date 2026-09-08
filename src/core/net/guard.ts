import { lookup as dnsLookup } from "node:dns/promises";

import { AppError } from "@/core/errors";

/**
 * Stops a crawl from being steered into the machine it runs on.
 *
 * The tension this resolves: Grape's audience legitimately points it at
 * `http://localhost:3000` — their own dev server — so a blanket ban on private
 * addresses would break a real use case. But a *public* site must not be able
 * to redirect the crawler to 169.254.169.254 and have the contents stored,
 * summarised by a model and rendered on the dashboard.
 *
 * The resolution is consent: the entry URL was typed by the only human this
 * system has, so it is trusted whatever it resolves to. Every other host —
 * reached by a link, a redirect or a cross-origin manifest — has to be public.
 */

export type Lookup = (hostname: string) => Promise<string[]>;

const realLookup: Lookup = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true });
  return results.map((r) => r.address);
};

export interface TargetPolicy {
  /** Trusted unconditionally: the person running Grape asked for this host. */
  entryHost: string;
  lookup: Lookup;
}

export function policyForEntry(entryUrl: string, lookup: Lookup = realLookup): TargetPolicy {
  return { entryHost: new URL(entryUrl).hostname.toLowerCase(), lookup };
}

export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase();

  if (ip.startsWith("::ffff:")) return isPrivateAddress(ip.slice(7));

  if (ip.includes(":")) {
    if (ip === "::1" || ip === "::") return true;
    const head = parseInt(ip.split(":")[0] || "0", 16);
    if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    return false;
  }

  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true;
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0/24 protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast and reserved
  return false;
}

/**
 * Whether a *hostname* names this machine or a private network — used to
 * notice when the entry URL is local, not to block it.
 */
const LOCAL_HOSTNAMES = new Set(["localhost", "0.0.0.0", "127.0.0.1", "::1"]);

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOCAL_HOSTNAMES.has(host)) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const looksLikeAddress = host.includes(":") || /^[\d.]+$/.test(host);
  return looksLikeAddress ? isPrivateAddress(host) : false;
}

export async function assertAllowedTarget(url: string, policy: TargetPolicy): Promise<void> {
  const { hostname, protocol } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") {
    throw new AppError("CRAWL_BLOCKED_TARGET", `Refusing non-http target: ${url}`);
  }

  if (hostname.toLowerCase() === policy.entryHost) return;

  let addresses: string[];
  try {
    addresses = await policy.lookup(hostname);
  } catch (error) {
    throw new AppError("CRAWL_UNREACHABLE", `Could not resolve ${hostname}`, { cause: error });
  }

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new AppError(
      "CRAWL_BLOCKED_TARGET",
      `Refusing to fetch ${url}: resolves to a private address`,
    );
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions {
  policy: TargetPolicy;
  timeoutMs: number;
  fetchImpl: typeof fetch;
  maxRedirects?: number;
}

/**
 * Follows redirects by hand so every hop is re-checked against the policy, and
 * so the caller learns the *final* URL. That second part fixes a real bug:
 * relative links were being resolved against the URL originally requested, so
 * a site redirecting `/` to `/en/` produced links pointing at the wrong paths.
 */
export async function safeFetch(
  url: string,
  init: RequestInit,
  options: SafeFetchOptions,
): Promise<{ response: Response; finalUrl: string }> {
  const maxRedirects = options.maxRedirects ?? 5;
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertAllowedTarget(current, options.policy);

    const response = await options.fetchImpl(current, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: current };

    const location = response.headers.get("location");
    if (!location) return { response, finalUrl: current };

    await response.body?.cancel().catch(() => {});
    current = new URL(location, current).toString();
  }

  throw new AppError("CRAWL_UNREACHABLE", `More than ${maxRedirects} redirects starting at ${url}`);
}
