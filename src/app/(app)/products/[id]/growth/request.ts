/**
 * The one way the growth screens talk to their API: JSON in, JSON out, and
 * the server's own sentence on failure (see server/http/errors.ts) — never a
 * raw status code in front of the reader.
 */
export async function send<T = unknown>(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, data: payload as T };
    return { ok: false, error: (payload as { error?: string }).error ?? "うまくいきませんでした。もう一度お試しください。" };
  } catch {
    return { ok: false, error: "通信できませんでした。接続を確認して、もう一度お試しください。" };
  }
}
