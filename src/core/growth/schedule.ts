import { tokyoDay, tokyoHour } from "./policy";

/**
 * When each idea is due. One post a day by default: what a person working
 * alone can review, and slow enough that a day's result is not buried by the
 * next. Days already holding their share are skipped, so topping up the
 * backlog never doubles a day.
 */

export const DEFAULT_POSTS_PER_DAY = 1;
const DAY_MS = 86_400_000;
/** After this hour in Japan, today is no longer a day to start on. */
const LAST_START_HOUR = 20;

export function dayAfter(now: Date, days: number): string {
  return tokyoDay(new Date(now.getTime() + days * DAY_MS));
}

/** `count` dates, in order, none on a day that already has `perDay` planned. `taken` counts what is planned per day. */
export function planDates(count: number, now: Date, perDay: number, taken: Record<string, number>): string[] {
  const cap = Math.max(1, perDay);
  const used = { ...taken };
  const dates: string[] = [];
  let offset = tokyoHour(now) >= LAST_START_HOUR ? 1 : 0;
  while (dates.length < count && offset < 400) {
    const day = dayAfter(now, offset);
    if ((used[day] ?? 0) < cap) {
      used[day] = (used[day] ?? 0) + 1;
      dates.push(day);
    } else {
      offset += 1;
    }
  }
  return dates;
}

/** A1, B1, A2, B2, …: the groups take turns, so each hypothesis meets every weekday alike. */
export function interleave<T>(groups: T[][]): T[] {
  const result: T[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let i = 0; i < longest; i++) for (const group of groups) if (i < group.length) result.push(group[i]);
  return result;
}
