/**
 * Reads a response body with a hard byte ceiling.
 *
 * `response.text()` is unbounded, and the 15-second crawl timeout only covers
 * how long the request takes — a fast server can stream hundreds of megabytes
 * inside it, on a machine with 8 GB of RAM. Truncated HTML still parses fine
 * under cheerio, and the text is sliced to maxTextChars immediately afterwards
 * anyway, so nothing of value is lost by stopping early.
 */
export interface CappedRead {
  text: string;
  truncated: boolean;
}

export async function readTextCapped(response: Response, maxBytes: number): Promise<CappedRead> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return { text: "", truncated: true };
  }

  if (!response.body) return { text: await response.text(), truncated: false };

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let bytes = 0;
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        // Decode the part that fits, then stop pulling.
        text += decoder.decode(value.subarray(0, value.byteLength - (bytes - maxBytes)));
        return { text, truncated: true };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { text, truncated: false };
  } finally {
    await reader.cancel().catch(() => {});
  }
}
