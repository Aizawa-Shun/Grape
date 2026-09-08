import { currentSettings } from "@/core/settings";

import { currentRequestId } from "./context";

/**
 * One JSON line per event, no dependency. The whole repo previously logged
 * four times total and threw every caught error away after returning it to the
 * browser, so a failed diagnosis left no record of what the model actually
 * said.
 *
 * In an interactive terminal it prints a human line instead, because a log
 * nobody can read while developing is a log nobody reads.
 */

type Level = "debug" | "info" | "warn" | "error";

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

/** Read per call, not at import, so tests and `GRAPE_LOG_FORMAT` can steer it. */
function wantsJson(): boolean {
  const forced = process.env.GRAPE_LOG_FORMAT;
  if (forced === "json") return true;
  if (forced === "human") return false;
  return !process.stdout.isTTY || process.env.NODE_ENV === "production";
}

function formatHuman(record: Record<string, unknown>): string {
  const { t, lvl, evt, ...rest } = record;
  const time = typeof t === "string" ? t.slice(11, 19) : "";
  const inline: string[] = [];
  const blocks: string[] = [];

  for (const [key, value] of Object.entries(rest)) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (text !== undefined && text.includes("\n")) blocks.push(text);
    else inline.push(`${key}=${text}`);
  }

  const head = `${time} ${String(lvl).padEnd(5)} ${String(evt)}${inline.length ? " " + inline.join(" ") : ""}`;
  return blocks.length ? `${head}\n${blocks.map(indent).join("\n")}` : head;
}

function indent(block: string): string {
  return block
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function emit(level: Level, event: string, fields: LogFields = {}): void {
  if (RANK[level] < RANK[currentSettings().GRAPE_LOG_LEVEL]) return;

  const record: Record<string, unknown> = {
    t: new Date().toISOString(),
    lvl: level,
    evt: event,
  };
  const requestId = currentRequestId();
  if (requestId) record.req = requestId;
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) record[key] = value;
  }

  process.stdout.write((wantsJson() ? JSON.stringify(record) : formatHuman(record)) + "\n");
}

export const log = {
  debug: (event: string, fields?: LogFields) => emit("debug", event, fields),
  info: (event: string, fields?: LogFields) => emit("info", event, fields),
  warn: (event: string, fields?: LogFields) => emit("warn", event, fields),
  error: (event: string, fields?: LogFields) => emit("error", event, fields),
};

const STACK_FRAMES = 5;

/**
 * Flattens a thrown value into log fields. The stack is trimmed because the
 * useful part is where it was thrown, and an untrimmed Next.js stack buries
 * that under framework frames.
 */
export function describeError(error: unknown): LogFields {
  if (!(error instanceof Error)) return { error: String(error) };

  const fields: LogFields = {
    error: error.message,
    errorName: error.name,
    stack: error.stack?.split("\n").slice(1, 1 + STACK_FRAMES).join("\n"),
  };
  if (error.cause !== undefined) {
    fields.cause = error.cause instanceof Error ? error.cause.message : String(error.cause);
  }
  return fields;
}
