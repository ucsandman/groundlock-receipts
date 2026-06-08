import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  const filePath = path.join(dir, "notice.txt");
  const blockedPath = path.join(dir, "blocked.txt");
  await writeFile(sourcePath, JSON.stringify(source), "utf8");
  await writeFile(filePath, "Dear Jane Roe, return $2,000.00.", "utf8");
  await writeFile(blockedPath, "Dear Jane Roe, return $2,000.00 plus a $99.00 fee.", "utf8");
  return { dir, sourcePath, filePath, blockedPath };
}

describe("CLI entrypoint", () => {
  it("generates publisher key files without printing private key material", async () => {
    const { dir } = await fixtureDir();
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await main(["generate-key", "launch-key", "--out", dir]);

    expect(code).toBe(0);
    const out = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(out).toContain("kid launch-key");
    expect(out).toContain("private-key");
    expect(out).toContain("public-key");
    expect(out).not.toContain('"d"');

    const privateJwk = JSON.parse(await readFile(path.join(dir, "launch-key.private.jwk"), "utf8"));
    const publicJwk = JSON.parse(await readFile(path.join(dir, "launch-key.public.jwk"), "utf8"));
    expect(privateJwk).toEqual(expect.objectContaining({ kty: "OKP", crv: "Ed25519", d: expect.any(String) }));
    expect(publicJwk).toEqual(expect.objectContaining({ kty: "OKP", crv: "Ed25519", x: expect.any(String) }));
    expect(publicJwk).not.toHaveProperty("d");
  });

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
      "--site-url",
      "https://receipts.groundlock.dev/path",
      "--doh-endpoint",
      "https://resolver.example/dns-query",
    ]);

    expect(code).toBe(0);
    const out = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(out).toContain("GROUNDLOCK_SIGNER_DOMAIN=publisher.example");
    expect(out).toContain("NEXT_PUBLIC_SITE_URL=https://receipts.groundlock.dev");
    expect(out).toContain("GROUNDLOCK_DOH_ENDPOINT=https://resolver.example/dns-query");
    expect(out).toContain("GROUNDLOCK_STATUS_RECORDS_JSON=");
  });

  it("fails export-web-env when the live DoH endpoint is missing", async () => {
    const { dir, sourcePath, blockedPath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const outDir = path.join(dir, "publish");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
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
    stderr.mockClear();

    const code = await main([
      "export-web-env",
      path.join(outDir, "dns-fixture.json"),
      "--status-base-url",
      "https://publisher.example/groundlock/status",
      "--site-url",
      "https://receipts.groundlock.dev/path",
    ]);

    expect(code).toBe(1);
    const err = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(err).toContain("missing_flag:doh-endpoint");
  });

  it("fails export-web-env when launch URLs are not HTTPS", async () => {
    const { dir, sourcePath, blockedPath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const outDir = path.join(dir, "publish");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
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
    stderr.mockClear();

    const code = await main([
      "export-web-env",
      path.join(outDir, "dns-fixture.json"),
      "--status-base-url",
      "https://publisher.example/groundlock/status",
      "--site-url",
      "https://receipts.groundlock.dev/path",
      "--doh-endpoint",
      "http://resolver.example/dns-query",
    ]);

    expect(code).toBe(1);
    const err = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(err).toContain("invalid_doh_endpoint");
  });

  it("fails export-web-env when launch URLs include credentials or query suffixes", async () => {
    const { dir, sourcePath, blockedPath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const outDir = path.join(dir, "publish");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
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
    stderr.mockClear();

    const code = await main([
      "export-web-env",
      path.join(outDir, "dns-fixture.json"),
      "--status-base-url",
      "https://publisher.example/groundlock/status#fragment",
      "--site-url",
      "https://user:pass@receipts.groundlock.dev/path",
      "--doh-endpoint",
      "https://resolver.example/dns-query?bootstrap=1",
    ]);

    expect(code).toBe(1);
    const err = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(err).toContain("invalid_doh_endpoint");
  });

  it("writes launch-kit artifacts from the actual CLI command", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const outDir = path.join(dir, "publish");
    const kitDir = path.join(dir, "launch-kit");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await main([
      "local-publish",
      filePath,
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
      "launch-kit",
      path.join(outDir, "dns-fixture.json"),
      "--out",
      kitDir,
      "--site-url",
      "https://receipts.groundlock.dev/path",
      "--status-base-url",
      "https://publisher.example/groundlock/status",
      "--doh-endpoint",
      "https://resolver.example/dns-query",
      "--file-or-hash",
      filePath,
      "--ttl",
      "600",
    ]);

    expect(code).toBe(0);
    const out = stdout.mock.calls.map((call) => String(call[0])).join("");
    const summary = JSON.parse(await readFile(path.join(kitDir, "launch-summary.json"), "utf8"));
    const webEnv = await readFile(path.join(kitDir, "web.env"), "utf8");
    const checksums = await readFile(path.join(kitDir, "checksums.txt"), "utf8");
    expect(out).toContain("launch-kit");
    expect(out).toContain("content-hash");
    expect(out).toContain("checksums");
    expect(summary.contentHash).toBe(digestText(await readFile(filePath, "utf8")));
    expect(summary.receiptVerdict).toBe("pass");
    expect(summary.artifacts.checksums).toBe("checksums.txt");
    expect(summary.artifactSha256.dnsFixture).toMatch(/^sha256:[A-Za-z0-9_-]+$/);
    expect(checksums).toContain("dns-fixture.json");
    expect(webEnv).toContain("GROUNDLOCK_STATUS_RECORDS_JSON=");
  });

  it("prints setup-domain records from the actual CLI command without DNS mutation", async () => {
    const { dir } = await fixtureDir();
    const key = generateSigningKey("k1");
    const receipt = issueVerifiedReceipt(
      "Dear Jane Roe, return $2,000.00.",
      source,
      { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
      "2026-06-08T00:00:00.000Z",
      { signerDomain: "publisher.example", contentClass: "tenant-notice" },
    );
    const receiptPath = path.join(dir, "receipt.json");
    await writeFile(receiptPath, JSON.stringify(receipt), "utf8");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await main([
      "setup-domain",
      "publisher.example",
      "--receipt",
      receiptPath,
      "--public-key",
      JSON.stringify(key.publicKeyJwk),
    ]);

    expect(code).toBe(0);
    const out = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(out).toContain("_truename.publisher.example TXT");
    expect(out).toContain("cache-manifest");
    expect(out).toContain("cache-chunk");
    expect(out).toContain("DNS mutation: none");
  });

  it("prints setup-domain records as zone-file TXT lines on request", async () => {
    const { dir } = await fixtureDir();
    const key = generateSigningKey("k1");
    const receipt = issueVerifiedReceipt(
      "Dear Jane Roe, return $2,000.00.",
      source,
      { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
      "2026-06-08T00:00:00.000Z",
      { signerDomain: "publisher.example", contentClass: "tenant-notice" },
    );
    const receiptPath = path.join(dir, "receipt.json");
    await writeFile(receiptPath, JSON.stringify(receipt), "utf8");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const code = await main([
      "setup-domain",
      "publisher.example",
      "--receipt",
      receiptPath,
      "--public-key",
      JSON.stringify(key.publicKeyJwk),
      "--format",
      "zone",
      "--ttl",
      "600",
    ]);

    expect(code).toBe(0);
    const out = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(out).toContain('_truename.publisher.example. 600 IN TXT "');
    expect(out).toContain("._groundlock.publisher.example. 600 IN TXT ");
    expect(out).not.toContain("cache-manifest");
    expect(out).toContain("DNS mutation: none");
  });

  it("warms DNS cache fixture records through the configured DoH endpoint", async () => {
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
    const fixturePath = path.join(outDir, "dns-fixture.json");
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as { txt: Record<string, string[]> };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        const name = url.searchParams.get("name") ?? "";
        return jsonResponse({
          Status: fixture.txt[name] ? 0 : 3,
          AD: true,
          Answer: (fixture.txt[name] ?? []).map((data) => ({ type: 16, data: `"${data}"` })),
        });
      }),
    );
    stdout.mockClear();

    const code = await main([
      "warm-cache",
      fixturePath,
      "--doh-endpoint",
      "https://resolver.example/dns-query",
    ]);

    expect(code).toBe(0);
    const out = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(out).toContain("PASS warmed");
    expect(out).toContain(String(Object.keys(fixture.txt).length));
  });

  it("fails warm-cache when the live DoH endpoint is missing", async () => {
    const { dir, sourcePath, blockedPath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const outDir = path.join(dir, "publish");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
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
    stderr.mockClear();

    const code = await main([
      "warm-cache",
      path.join(outDir, "dns-fixture.json"),
    ]);

    expect(code).toBe(1);
    const err = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(err).toContain("missing_flag:doh-endpoint");
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

  it("fails check-live when the live DoH endpoint is missing", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const code = await main([
      "check-live",
      "sha256:abc123",
      "--domain",
      "publisher.example",
      "--status-base-url",
      "https://status.example/groundlock",
    ]);

    expect(code).toBe(1);
    const err = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(err).toContain("missing_flag:doh-endpoint");
  });

  it("fails check-live before network calls when launch URLs are invalid", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const code = await main([
      "check-live",
      "sha256:abc123",
      "--domain",
      "publisher.example",
      "--doh-endpoint",
      "https://resolver.example/dns-query",
      "--status-base-url",
      "not-url",
    ]);

    expect(code).toBe(1);
    const err = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(err).toContain("invalid_status_base_url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}
