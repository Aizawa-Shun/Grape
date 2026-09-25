/**
 * The fallback half of crawling: render a page the way a browser would.
 *
 * Grape fetches plain HTML first and only comes here when that produced no
 * readable text, because launching a browser costs ~300 MB of RAM on a machine
 * that has 8 GB and the overwhelming majority of indie landing pages are static
 * or server-rendered. But a client-rendered app (Expo Router, CRA, Vite SPA)
 * ships an empty `<div id="root">` and nothing else, and refusing to read those
 * means refusing to read a real, working product — so the browser exists as an
 * escape hatch, not as the default path.
 *
 * Playwright is imported lazily and every failure is soft. A checkout that
 * never ran `npx playwright install chromium` still crawls static sites
 * normally; it just cannot rescue client-rendered ones.
 *
 * Two places to find a browser, tried in order (see launchChromium):
 * Playwright's own download, which is what a developer machine has after
 * `npx playwright install chromium`, and @sparticuz/chromium, a
 * self-contained Chromium built to run in serverless containers — which is
 * what App Hosting is (Cloud Run), with no browser in its base image and no
 * way to run `playwright install` at deploy time.
 */

import { log } from "@/server/log";

export interface RenderedPage {
  html: string;
  status: number;
}

export interface RenderOptions {
  /**
   * BCP-47 tag the page declared for itself (`<html lang>`). A client-rendered
   * app commonly picks its copy from `navigator.language`, so leaving this at
   * Chromium's default renders a Japanese product in English — and a Product
   * Context that records the wrong language goes on to produce posts in the
   * wrong language for its audience.
   */
  locale?: string | null;
}

/** Kept open across one crawl — launching Chromium per page dominates the cost. */
export interface PageRenderer {
  render(url: string, options?: RenderOptions): Promise<RenderedPage | null>;
  close(): Promise<void>;
}

const NOOP_RENDERER: PageRenderer = {
  async render() {
    return null;
  },
  async close() {},
};

/** Ceiling on fetching the document itself, before any script runs. */
const NAVIGATION_TIMEOUT_MS = 20_000;

/**
 * How long to let client-side JavaScript put text on the page.
 *
 * Deliberately not `waitUntil: "networkidle"`. Network quiet is a proxy for
 * "the app has rendered" and it is a bad one: measured against a live Expo
 * Router app, idle was reached seconds before React mounted anything, and the
 * crawl came back with the same empty shell the plain fetch already had. The
 * page also kept a failing request in flight and ran animation frames
 * indefinitely, so idle either arrived early or not at all. Waiting on the
 * thing we actually want — text in the body — is both more accurate and
 * faster, because a page that is already rendered satisfies it immediately.
 */
const HYDRATION_TIMEOUT_MS = 20_000;

/**
 * Enough text to distinguish a mounted page from a splash screen or a
 * "Loading…" placeholder, low enough that a genuinely terse landing page still
 * clears it. Falling short is not fatal: whatever is on the page at the
 * deadline gets returned anyway.
 */
const MIN_RENDERED_TEXT_CHARS = 50;

let launchWarningLogged = false;

type Chromium = typeof import("playwright").chromium;
type Browser = Awaited<ReturnType<Chromium["launch"]>>;

/**
 * On a serverless container (Cloud Run sets K_SERVICE) the bundled Chromium
 * is tried first, since Playwright's download is never there; anywhere else
 * Playwright's own browser comes first and the bundled one is the fallback.
 */
async function launchChromium(chromium: Chromium): Promise<Browser | null> {
  const serverless = Boolean(process.env.K_SERVICE);
  const attempts = serverless ? [bundled, playwrights] : [playwrights, bundled];
  const failures: string[] = [];

  for (const attempt of attempts) {
    try {
      return await attempt(chromium);
    } catch (error) {
      failures.push(describe(error));
    }
  }

  // The package can be present while no browser binary is, which is the
  // normal state after `pnpm install` without `npx playwright install`.
  warnOnce(
    `could not launch Chromium (${failures.join("; ")}) — run \`npx playwright install chromium\` to read client-rendered pages.`,
  );
  return null;
}

function playwrights(chromium: Chromium): Promise<Browser> {
  return chromium.launch({ headless: true });
}

async function bundled(chromium: Chromium): Promise<Browser> {
  const { default: sparticuz } = await import("@sparticuz/chromium");
  return chromium.launch({
    headless: true,
    executablePath: await sparticuz.executablePath(),
    args: sparticuz.args,
  });
}

export async function createPageRenderer(): Promise<PageRenderer> {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    warnOnce("playwright is not installed — client-rendered pages will stay unread.");
    return NOOP_RENDERER;
  }

  const browser = await launchChromium(chromium);
  if (!browser) return NOOP_RENDERER;

  return {
    async render(url: string, options: RenderOptions = {}): Promise<RenderedPage | null> {
      let context;
      try {
        context = await browser.newContext({
          userAgent: BROWSER_USER_AGENT,
          // A phone-sized viewport would trip mobile layouts that hide copy
          // behind a menu; the desktop layout is the one that states the value
          // proposition in full.
          viewport: { width: 1280, height: 900 },
          ...(options.locale ? { locale: options.locale } : {}),
        });
        const page = await context.newPage();
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: NAVIGATION_TIMEOUT_MS,
        });

        // A page that never puts text up is still worth reading — it may carry
        // meta or a manifest — so a timeout here is not an error.
        await page
          .waitForFunction(
            (min: number) => (document.body?.innerText.trim().length ?? 0) >= min,
            MIN_RENDERED_TEXT_CHARS,
            { timeout: HYDRATION_TIMEOUT_MS },
          )
          .catch(() => {});

        const html = await page.content();
        return { html, status: response?.status() ?? 200 };
      } catch (error) {
        // Same contract as a failed fetch: an unreadable page is a data point,
        // not a crash. The static result stands.
        warnOnce(`render failed for ${url}: ${describe(error)}`);
        return null;
      } finally {
        await context?.close().catch(() => {});
      }
    },
    async close() {
      await browser.close().catch(() => {});
    },
  };
}

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 GrapeBot/0.1";

function describe(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

/**
 * One line per process. A missing browser is a permanent condition for the run,
 * and repeating it once per page turns the log into noise.
 */
function warnOnce(message: string): void {
  if (launchWarningLogged) return;
  launchWarningLogged = true;
  log.warn("crawl.browser_unavailable", { reason: message });
}
