import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClaimStatusRecord,
  createDnsCacheRecords,
  createKeyStatusRecord,
  digestText,
  generateSigningKey,
  issueVerifiedReceipt,
  receiptStatusHash,
  type SourceOfTruth,
} from "@groundlock/core";
import { exampleSource } from "../lib/examples";

const liveCandidate =
  "Notice for Jane Roe: account AC-40192 has a balance of $1,500.00 due by June 1, 2026.";

const originalEnv = {
  GROUNDLOCK_SIGNER_DOMAIN: process.env.GROUNDLOCK_SIGNER_DOMAIN,
  GROUNDLOCK_DOH_ENDPOINT: process.env.GROUNDLOCK_DOH_ENDPOINT,
  GROUNDLOCK_STATUS_BASE_URL: process.env.GROUNDLOCK_STATUS_BASE_URL,
};

afterEach(() => {
  restoreEnv("GROUNDLOCK_SIGNER_DOMAIN", originalEnv.GROUNDLOCK_SIGNER_DOMAIN);
  restoreEnv("GROUNDLOCK_DOH_ENDPOINT", originalEnv.GROUNDLOCK_DOH_ENDPOINT);
  restoreEnv("GROUNDLOCK_STATUS_BASE_URL", originalEnv.GROUNDLOCK_STATUS_BASE_URL);
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("live public verifier", () => {
  it("fails closed when live mode lacks an explicit DoH endpoint", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "live.example";
    delete process.env.GROUNDLOCK_DOH_ENDPOINT;
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://status.example/groundlock";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { verifyPublicContentHash } = await import("../lib/public-verifier");
    const result = await verifyPublicContentHash(digestText(liveCandidate));

    expect(result).toEqual(expect.objectContaining({
      state: "UNVERIFIABLE",
      code: "doh_resolver_not_configured",
    }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["DoH endpoint", "GROUNDLOCK_DOH_ENDPOINT", "http://resolver.example/dns-query", "doh_resolver_invalid"],
    ["status base URL", "GROUNDLOCK_STATUS_BASE_URL", "not-url", "status_resolver_invalid"],
  ])("fails closed when live mode has an invalid %s", async (_label, key, value, code) => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "live.example";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://status.example/groundlock";
    process.env[key] = value;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { verifyPublicContentHash } = await import("../lib/public-verifier");
    const result = await verifyPublicContentHash(digestText(liveCandidate));

    expect(result).toEqual(expect.objectContaining({
      state: "UNVERIFIABLE",
      code,
    }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reconstructs receipts from configured DoH TXT records and HTTP status records", async () => {
    const signerDomain = "live.example";
    const key = generateSigningKey("live-key-1");
    const receipt = issueVerifiedReceipt(
      liveCandidate,
      exampleSource as SourceOfTruth,
      { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
      "2026-06-08T00:00:00.000Z",
      { signerDomain, contentClass: "live-demo" },
    );
    const receiptHash = receiptStatusHash(receipt);
    const records = createDnsCacheRecords(receipt, key.publicKeyJwk, { chunkSize: 180 });
    const txt = Object.fromEntries(
      [records.identity, records.manifest, ...records.chunks].map((record) => [record.name, [record.value]]),
    );
    const keyStatus = createKeyStatusRecord({
      signerDomain,
      kid: key.kid,
      status: "active",
      issuedAt: receipt.issuedAt,
    });
    const claimStatus = createClaimStatusRecord({
      receiptHash,
      status: "active",
      issuedAt: receipt.issuedAt,
    });
    const fetchedStatusLookups: string[] = [];

    process.env.GROUNDLOCK_SIGNER_DOMAIN = signerDomain;
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://status.example/groundlock";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.origin === "https://resolver.example") {
          const name = url.searchParams.get("name") ?? "";
          return jsonResponse({
            Status: txt[name] ? 0 : 3,
            AD: true,
            Answer: (txt[name] ?? []).map((data) => ({ type: 16, data: `"${data}"` })),
          });
        }
        if (url.href.startsWith("https://status.example/groundlock/key?")) {
          fetchedStatusLookups.push(url.searchParams.get("lookup") ?? "");
          return jsonResponse(keyStatus);
        }
        if (url.href.startsWith("https://status.example/groundlock/claim?")) {
          fetchedStatusLookups.push(url.searchParams.get("lookup") ?? "");
          return jsonResponse(claimStatus);
        }
        throw new Error(`unexpected fetch ${url.href}`);
      }),
    );

    const { verifyPublicContentHash } = await import("../lib/public-verifier");
    const result = await verifyPublicContentHash(digestText(liveCandidate));

    expect(result).toEqual(expect.objectContaining({ state: "PASS", code: "verified" }));
    expect(result.receipt).toEqual(expect.objectContaining({ signerDomain, signerKeyId: key.kid }));
    expect(fetchedStatusLookups).toEqual([`key:${signerDomain}:${key.kid}`, `claim:${receiptHash}`]);
  });
});

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}

function restoreEnv(name: keyof typeof originalEnv, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
