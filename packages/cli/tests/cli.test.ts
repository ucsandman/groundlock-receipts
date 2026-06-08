import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
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
import { main } from "../src/cli.js";

const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "amount", value: "$2,000.00" }],
  extract: { money: true, dates: false, percentages: false },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function fixtureDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "groundlock-cli-main-"));
  const sourcePath = path.join(dir, "source.json");
  const blockedPath = path.join(dir, "blocked.txt");
  await writeFile(sourcePath, JSON.stringify(source), "utf8");
  await writeFile(blockedPath, "Dear Jane Roe, return $2,000.00 plus a $99.00 fee.", "utf8");
  return { dir, sourcePath, blockedPath };
}

describe("CLI entrypoint", () => {
  it("returns BLOCK exit semantics from the actual local-publish command", async () => {
    const { dir, sourcePath, blockedPath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const outDir = path.join(dir, "publish");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await main([
      "local-publish",
      blockedPath,
      "--source",
      sourcePath,
      "--domain",
      "publisher.example",
      "--kid",
      key.kid,
      "--key",
      JSON.stringify(key.privateKeyJwk),
      "--public-key",
      JSON.stringify(key.publicKeyJwk),
      "--out",
      outDir,
    ]);

    expect(code).toBe(2);
    const out = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(out).toContain("state BLOCK");
    expect(out).toContain("cache-manifest");
    expect(out).toContain("cache-chunk");
  });

  it("prints a web verifier env bundle from a local fixture", async () => {
    const { dir, sourcePath, blockedPath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const outDir = path.join(dir, "publish");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await main([
      "local-publish",
      blockedPath,
      "--source",
      sourcePath,
      "--domain",
      "publisher.example",
      "--kid",
      key.kid,
      "--key",
      JSON.stringify(key.privateKeyJwk),
      "--public-key",
      JSON.stringify(key.publicKeyJwk),
      "--out",
      outDir,
    ]);
    stdout.mockClear();

    const code = await main([
      "export-web-env",
      path.join(outDir, "dns-fixture.json"),
      "--status-base-url",
      "https://publisher.example/groundlock/status",
    ]);

    expect(code).toBe(0);
    const out = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(out).toContain("GROUNDLOCK_SIGNER_DOMAIN=publisher.example");
    expect(out).toContain("GROUNDLOCK_STATUS_RECORDS_JSON=");
  });

  it("checks a live DNS-cache verifier deployment through DoH and status endpoints", async () => {
    const signerDomain = "publisher.example";
    const key = generateSigningKey("live-key");
    const candidate = "Dear Jane Roe, return $2,000.00.";
    const receipt = issueVerifiedReceipt(
      candidate,
      source,
      { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
      "2026-06-08T00:00:00.000Z",
      { signerDomain, contentClass: "tenant-notice" },
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
          return jsonResponse(keyStatus);
        }
        if (url.href.startsWith("https://status.example/groundlock/claim?")) {
          return jsonResponse(claimStatus);
        }
        throw new Error(`unexpected fetch ${url.href}`);
      }),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await main([
      "check-live",
      digestText(candidate),
      "--domain",
      signerDomain,
      "--doh-endpoint",
      "https://resolver.example/dns-query",
      "--status-base-url",
      "https://status.example/groundlock",
    ]);

    expect(code).toBe(0);
    expect(stdout.mock.calls.map((call) => String(call[0])).join("")).toContain("PASS verified");
  });
});

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}
