import { defineSecret, defineString } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";

/**
 * Grape's weekly loop, on a schedule: once a day, ask the App Hosting backend
 * to run one tick (src/core/loop/tick.ts) — finish any setup left pending,
 * measure tasks whose seven days are up, re-diagnose products whose last
 * diagnosis is over a week old.
 *
 * Deliberately a thin trigger that calls the app rather than a copy of it:
 * the tick needs the whole of Grape (the store, the LLM layer, each owner's
 * API key and budget), all of which already lives in the backend. This only
 * has to be on time and present the secret.
 *
 * GRAPE_URL is the backend's public URL (asked for on first deploy, saved
 * to functions/.env.<project>). GRAPE_CRON_SECRET is the same Secret
 * Manager secret apphosting.yaml gives the backend.
 */
const grapeUrl = defineString("GRAPE_URL", {
  description: "Grape's App Hosting URL, e.g. https://grape--your-project.asia-east1.hosted.app",
});
const cronSecret = defineSecret("GRAPE_CRON_SECRET");

export const weeklyLoop = onSchedule(
  {
    // 09:30 in Japan, so a fresh diagnosis is waiting at the start of the day.
    // Daily rather than weekly: "due" is decided per task and per product, so
    // a daily tick picks each up within a day and does nothing otherwise.
    schedule: "30 9 * * *",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
    secrets: [cronSecret],
    timeoutSeconds: 540,
    // A failed tick is retried by the next day's; retrying at once would
    // mostly hit the same cold start or the same model outage.
    retryCount: 0,
  },
  async () => {
    const url = `${grapeUrl.value().replace(/\/+$/, "")}/api/cron/tick`;
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${cronSecret.value()}` },
      signal: AbortSignal.timeout(530_000),
    });
    const body = await response.text();

    if (!response.ok) {
      logger.error("weekly loop tick failed", { status: response.status, body: body.slice(0, 2000) });
      throw new Error(`tick answered ${response.status}`);
    }
    logger.info("weekly loop tick", JSON.parse(body));
  },
);
