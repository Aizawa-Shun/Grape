import { describe, expect, it, vi } from "vitest";

import { assertAllowedTarget, isPrivateAddress, isPrivateHost, policyForEntry, safeFetch } from "./guard";

const publicLookup = async () => ["93.184.216.34"];
const privateLookup = async () => ["127.0.0.1"];

describe("isPrivateAddress", () => {
  it("blocks every range that points back inside the network", () => {
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1", // IPv4-mapped loopback
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1::1"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it("treats anything unparseable as private rather than guessing", () => {
    expect(isPrivateAddress("not-an-address")).toBe(true);
  });
});

describe("isPrivateHost", () => {
  it("recognises the names a developer actually types for their own machine", () => {
    for (const host of ["localhost", "127.0.0.1", "myapp.local", "app.localhost", "::1"]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
    expect(isPrivateHost("example.com")).toBe(false);
  });
});

describe("assertAllowedTarget", () => {
  it("trusts the entry host without resolving it — this is what keeps localhost usable", async () => {
    const lookup = vi.fn(privateLookup);
    const policy = policyForEntry("http://localhost:3000/", lookup);

    await expect(assertAllowedTarget("http://localhost:3000/about", policy)).resolves.toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("blocks another host that resolves inward, which is the actual attack", async () => {
    const policy = policyForEntry("https://example.com/", privateLookup);

    await expect(
      assertAllowedTarget("http://169.254.169.254/latest/meta-data/", policy),
    ).rejects.toMatchObject({ code: "CRAWL_BLOCKED_TARGET" });
  });

  it("allows another host that resolves publicly", async () => {
    const policy = policyForEntry("https://example.com/", publicLookup);

    await expect(assertAllowedTarget("https://cdn.example.net/x", policy)).resolves.toBeUndefined();
  });

  it("refuses a non-http scheme outright", async () => {
    const policy = policyForEntry("https://example.com/", publicLookup);

    await expect(assertAllowedTarget("file:///etc/passwd", policy)).rejects.toMatchObject({
      code: "CRAWL_BLOCKED_TARGET",
    });
  });
});

describe("safeFetch", () => {
  function redirectingFetch(chain: Record<string, string>, final = "<html>done</html>") {
    return (async (url: string) => {
      const target = chain[String(url)];
      if (target) {
        return new Response(null, { status: 302, headers: { location: target } });
      }
      return new Response(final, { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
  }

  const policy = policyForEntry("https://example.com/", publicLookup);

  it("reports where it ended up, not where it was asked to go", async () => {
    const { finalUrl, response } = await safeFetch(
      "https://example.com/",
      {},
      {
        policy,
        timeoutMs: 1000,
        fetchImpl: redirectingFetch({ "https://example.com/": "/en/" }),
      },
    );

    expect(finalUrl).toBe("https://example.com/en/");
    expect(response.status).toBe(200);
  });

  it("re-checks every hop, so a public site cannot redirect the crawler inward", async () => {
    await expect(
      safeFetch("https://example.com/", {}, {
        policy: policyForEntry("https://example.com/", privateLookup),
        timeoutMs: 1000,
        fetchImpl: redirectingFetch({ "https://example.com/": "http://10.0.0.1/secrets" }),
      }),
    ).rejects.toMatchObject({ code: "CRAWL_BLOCKED_TARGET" });
  });

  it("gives up on a redirect loop instead of following it forever", async () => {
    await expect(
      safeFetch("https://example.com/a", {}, {
        policy,
        timeoutMs: 1000,
        maxRedirects: 3,
        fetchImpl: redirectingFetch({
          "https://example.com/a": "/b",
          "https://example.com/b": "/a",
        }),
      }),
    ).rejects.toMatchObject({ code: "CRAWL_UNREACHABLE" });
  });
});
