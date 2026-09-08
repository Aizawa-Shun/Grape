import { describe, expect, it } from "vitest";

import {
  buildAuthHeader,
  buildSignatureBaseString,
  estimateXPostCostUsd,
  percentEncode,
  signHmacSha1,
} from "./x";

/**
 * Appendix A of the OAuth Core 1.0a specification (oauth.net/core/1.0a) —
 * its complete worked example, fetched from the spec itself rather than
 * recalled, and cross-checked independently with `openssl dgst -hmac` before
 * being pinned here. Getting the signing wrong is otherwise undebuggable from
 * the outside: X's API answers a bad signature with a generic 401, not a
 * diff — so this test pins a published expected output rather than only
 * checking the code against itself.
 */
const REFERENCE = {
  method: "GET",
  url: "http://photos.example.net/photos",
  params: {
    file: "vacation.jpg",
    size: "original",
    oauth_consumer_key: "dpf43f3p2l4k3l03",
    oauth_token: "nnch734d00sl2jdk",
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: "1191242096",
    oauth_nonce: "kllo9940pd9333jh",
    oauth_version: "1.0",
  },
  consumerSecret: "kd94hf93k423kf44",
  tokenSecret: "pfkkdhi9sl3r4s00",
  expectedBaseString:
    "GET&http%3A%2F%2Fphotos.example.net%2Fphotos&file%3Dvacation.jpg%26oauth_consumer_key%3Ddpf43f3p2l4k3l03%26oauth_nonce%3Dkllo9940pd9333jh%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1191242096%26oauth_token%3Dnnch734d00sl2jdk%26oauth_version%3D1.0%26size%3Doriginal",
  expectedSignature: "tR3+Ty81lMeYAr/Fid0kMTYa/WM=",
};

describe("percentEncode", () => {
  it("escapes !*'() which encodeURIComponent alone leaves untouched", () => {
    expect(percentEncode("!*'()")).toBe("%21%2A%27%28%29");
  });

  it("escapes space and reserved URL characters", () => {
    expect(percentEncode("a b+c/d=e&f")).toBe("a%20b%2Bc%2Fd%3De%26f");
  });
});

describe("buildSignatureBaseString", () => {
  it("reproduces X's published reference base string exactly", () => {
    expect(buildSignatureBaseString(REFERENCE.method, REFERENCE.url, REFERENCE.params)).toBe(
      REFERENCE.expectedBaseString,
    );
  });
});

describe("signHmacSha1", () => {
  it("reproduces X's published reference signature exactly", () => {
    expect(signHmacSha1(REFERENCE.expectedBaseString, REFERENCE.consumerSecret, REFERENCE.tokenSecret)).toBe(
      REFERENCE.expectedSignature,
    );
  });
});

describe("buildAuthHeader", () => {
  const credentials = {
    consumerKey: REFERENCE.params.oauth_consumer_key,
    consumerSecret: REFERENCE.consumerSecret,
    accessToken: REFERENCE.params.oauth_token,
    accessTokenSecret: REFERENCE.tokenSecret,
  };

  it("produces the reference signature end to end when given the same nonce and timestamp", () => {
    const header = buildAuthHeader(
      REFERENCE.method,
      REFERENCE.url,
      credentials,
      { file: REFERENCE.params.file, size: REFERENCE.params.size },
      { nonce: REFERENCE.params.oauth_nonce, timestamp: REFERENCE.params.oauth_timestamp },
    );

    expect(header).toContain(`oauth_signature="${percentEncode(REFERENCE.expectedSignature)}"`);
    expect(header).toContain(`oauth_consumer_key="${REFERENCE.params.oauth_consumer_key}"`);
    expect(header).toMatch(/^OAuth /);
  });

  it("never includes the extra signed params themselves in the header", () => {
    const header = buildAuthHeader("POST", "https://api.x.com/2/tweets", credentials, { status: "hello" });
    expect(header).not.toContain("status=");
  });
});

describe("estimateXPostCostUsd", () => {
  it("prices a bare post at the base rate", () => {
    expect(estimateXPostCostUsd("just an update, no link here")).toBe(0.015);
  });

  it("prices a post containing a link at the higher rate", () => {
    expect(estimateXPostCostUsd("check it out: https://example.com")).toBe(0.2);
  });

  it("treats http and https links the same", () => {
    expect(estimateXPostCostUsd("http://example.com")).toBe(0.2);
  });
});
