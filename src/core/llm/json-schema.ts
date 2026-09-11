import { z, type ZodType } from "zod";

import { LLMError } from "./types";

type JsonSchemaNode = Record<string, unknown>;

/**
 * Zod 4 emits JSON Schema natively. We tighten it afterwards because the
 * providers that take a raw schema behave much better when every object is
 * closed and fully required:
 *
 *   - OpenAI's `strict: true` json_schema mode *rejects* schemas that leave
 *     `additionalProperties` open or list optional properties.
 *   - A self-hosted server compiling the schema into a decoding grammar (as
 *     llama.cpp and vLLM both can) lets an open object invent extra keys and
 *     wander — closing it keeps a small model on the rails.
 */
export function toProviderJsonSchema(schema: ZodType<unknown>): JsonSchemaNode {
  return closeObjects(z.toJSONSchema(schema, { io: "output" }) as JsonSchemaNode);
}

function closeObjects(node: unknown): JsonSchemaNode {
  if (Array.isArray(node)) {
    return node.map(closeObjects) as unknown as JsonSchemaNode;
  }
  if (node === null || typeof node !== "object") {
    return node as JsonSchemaNode;
  }

  const out: JsonSchemaNode = {};
  for (const [key, value] of Object.entries(node as JsonSchemaNode)) {
    out[key] = closeObjects(value);
  }

  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as JsonSchemaNode);
  }
  return out;
}

/**
 * Some local models still wrap JSON in prose or a fenced block even under a
 * grammar. Pull out the outermost JSON value before parsing.
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced) return fenced[1];

  const firstBrace = trimmed.search(/[{[]/);
  if (firstBrace === -1) return trimmed;
  const lastBrace = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  return lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1) : trimmed;
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * The non-throwing core, so the repair loop in structured.ts can decide
 * whether a failure is worth another attempt instead of having that decision
 * made for it by an exception.
 */
export function tryParseStructured<T>(raw: string, schema: ZodType<T>): ParseOutcome<T> {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch {
    return { ok: false, reason: "JSONとして解釈できませんでした" };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, reason: `項目が要求と合っていません — ${detail}` };
  }
  return { ok: true, value: parsed.data };
}

/**
 * The safety net that makes every provider behave identically. Constrained
 * decoding is a hint, not a guarantee — the Zod schema is the actual contract,
 * so a provider that drifts fails loudly here instead of quietly handing
 * malformed data to the Decision Engine.
 */
export function parseStructured<T>(raw: string, schema: ZodType<T>, provider: string, schemaName: string): T {
  const outcome = tryParseStructured(raw, schema);
  if (outcome.ok) return outcome.value;

  throw new LLMError(
    `Model output for "${schemaName}" was unusable (${outcome.reason}): ${raw.slice(0, 300)}`,
    provider,
    "bad_output",
  );
}

/** Reasoning models such as qwen3 prefix free-text answers with a think block. */
export function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}
