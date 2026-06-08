import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSigningKey, parseCacheManifestRecord } from "@groundlock/core";
import {
  localPublish,
  exportWebEnv,
  setupDomainRecords,
  signFile,
  warmDnsCache,
  verifyLive,
  verifyWithFixture,
} from "../src/publisher.js";
import type { SourceOfTruth } from "@groundlock/core";

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
  const dir = await mkdtemp(path.join(tmpdir(), "groundlock-cli-"));
  const sourcePath = path.join(dir, "source.json");
  const filePath = path.join(dir, "notice.txt");
  const blockedPath = path.join(dir, "blocked.txt");
  await writeFile(sourcePath, JSON.stringify(source), "utf8");
  await writeFile(filePath, "Dear Jane Roe, return $2,000.00.", "utf8");
  await writeFile(blockedPath, "Dear Jane Roe, return $2,000.00 plus a $99.00 fee.", "utf8");
  return { dir, sourcePath, filePath, blockedPath };
}

describe("publisher SDK", () => {
  it("signs a grounded file and returns non-zero semantics for blocked content", async () => {
    const { dir, sourcePath, filePath, blockedPath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const outPath = path.join(dir, "receipt.json");
    const blockedOutPath = path.join(dir, "blocked-receipt.json");

    const signed = await signFile({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      outPath,
    });
    expect(signed.exitCode).toBe(0);
    expect(JSON.parse(await readFile(outPath, "utf8")).verdict).toBe("pass");

    const blocked = await signFile({
      filePath: blockedPath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      outPath: blockedOutPath,
    });
    expect(blocked.exitCode).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(blockedOutPath, "utf8")).verdict).toBe("block");
  });

  it("publishes local artifacts and verifies PASS then REVOKED via fixture", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });

    expect(published.receiptPath).toContain("receipts");
    expect(published.statusPath).toContain("status");
    expect(published.fixturePath).toContain("dns-fixture.json");
    await expect(verifyWithFixture({ input: filePath, fixturePath: published.fixturePath, domain: "publisher.example" })).resolves.toEqual(
      expect.objectContaining({ state: "PASS" }),
    );

    const fixture = JSON.parse(await readFile(published.fixturePath, "utf8"));
    fixture.status.claim.status = "revoked";
    fixture.status.claim.reason = "test revocation";
    await writeFile(published.fixturePath, JSON.stringify(fixture, null, 2), "utf8");
    await expect(verifyWithFixture({ input: filePath, fixturePath: published.fixturePath, domain: "publisher.example" })).resolves.toEqual(
      expect.objectContaining({ state: "REVOKED" }),
    );
  });

  it("exports a pasteable web verifier env block from local publish fixtures", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });

    const env = await exportWebEnv({
      fixturePath: published.fixturePath,
      statusBaseUrl: "https://publisher.example/groundlock/status",
      dohEndpoint: "https://resolver.example/dns-query",
      siteUrl: "https://receipts.groundlock.dev/share",
    });

    expect(env).toContain("GROUNDLOCK_SIGNER_DOMAIN=publisher.example");
    expect(env).toContain("NEXT_PUBLIC_SITE_URL=https://receipts.groundlock.dev");
    expect(env).toContain("GROUNDLOCK_DOH_ENDPOINT=https://resolver.example/dns-query");
    expect(env).toContain("GROUNDLOCK_STATUS_BASE_URL=https://publisher.example/groundlock/status");
    expect(env).toContain("GROUNDLOCK_STATUS_RECORDS_JSON=");
    expect(env).toContain('"kind":"key"');
    expect(env).toContain('"kind":"claim"');
    expect(env).not.toContain("privateKeyJwk");
    expect(env).not.toContain("publicKeyJwk");
  });

  it("refuses to export a live web env block without an explicit DoH endpoint", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });

    const opts = {
      fixturePath: published.fixturePath,
      statusBaseUrl: "https://publisher.example/groundlock/status",
      siteUrl: "https://receipts.groundlock.dev/share",
    } as unknown as Parameters<typeof exportWebEnv>[0];

    await expect(exportWebEnv(opts)).rejects.toThrow("missing_doh_endpoint");
  });

  it.each([
    ["DoH endpoint", { dohEndpoint: "http://resolver.example/dns-query" }, "invalid_doh_endpoint"],
    ["status base URL", { statusBaseUrl: "not-url" }, "invalid_status_base_url"],
    ["site URL", { siteUrl: "http://receipts.groundlock.dev/share" }, "invalid_site_url"],
  ])("refuses to export a live web env block with an invalid %s", async (_label, override, error) => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });

    await expect(exportWebEnv({
      fixturePath: published.fixturePath,
      statusBaseUrl: "https://publisher.example/groundlock/status",
      dohEndpoint: "https://resolver.example/dns-query",
      siteUrl: "https://receipts.groundlock.dev/share",
      ...override,
    })).rejects.toThrow(error);
  });

  it("warms and validates all DNS cache fixture TXT records through DoH", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });
    const fixture = JSON.parse(await readFile(published.fixturePath, "utf8")) as { txt: Record<string, string[]> };
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

    const result = await warmDnsCache({
      fixturePath: published.fixturePath,
      dohEndpoint: "https://resolver.example/dns-query",
    });

    expect(result).toEqual({ state: "PASS", checked: Object.keys(fixture.txt).length, failures: [] });
  });

  it("refuses to warm DNS cache without an explicit DoH endpoint", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });
    const opts = { fixturePath: published.fixturePath } as unknown as Parameters<typeof warmDnsCache>[0];

    await expect(warmDnsCache(opts)).rejects.toThrow("missing_doh_endpoint");
  });

  it("refuses to warm DNS cache with an invalid live DoH endpoint", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(warmDnsCache({
      fixturePath: published.fixturePath,
      dohEndpoint: "http://resolver.example/dns-query",
    })).rejects.toThrow("invalid_doh_endpoint");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses live verification without an explicit DoH endpoint", async () => {
    const opts = {
      input: "sha256:abc123",
      domain: "publisher.example",
      statusBaseUrl: "https://publisher.example/groundlock/status",
    } as unknown as Parameters<typeof verifyLive>[0];

    await expect(verifyLive(opts)).rejects.toThrow("missing_doh_endpoint");
  });

  it.each([
    ["DoH endpoint", { dohEndpoint: "http://resolver.example/dns-query" }, "invalid_doh_endpoint"],
    ["status base URL", { statusBaseUrl: "not-url" }, "invalid_status_base_url"],
  ])("refuses live verification with an invalid %s", async (_label, override, error) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(verifyLive({
      input: "sha256:abc123",
      domain: "publisher.example",
      dohEndpoint: "https://resolver.example/dns-query",
      statusBaseUrl: "https://status.example/groundlock",
      ...override,
    })).rejects.toThrow(error);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("prints DNS cache records without HTTPS receipt storage or DNS mutation", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const signed = await signFile({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      outPath: path.join(dir, "receipt.json"),
    });
    const records = setupDomainRecords({
      receipt: signed.receipt,
      publicKeyJwk: key.publicKeyJwk,
      chunkSize: 80,
    });

    expect(records.mutatesDns).toBe(false);
    expect(records.identity.name).toBe("_truename.publisher.example");
    expect(records.manifest.name).toContain("._groundlock.publisher.example");
    expect(parseCacheManifestRecord(records.manifest.value)).toEqual(
      expect.objectContaining({ signerDomain: "publisher.example", kid: "k1", chunkCount: records.chunks.length }),
    );
    expect(records.chunks.length).toBeGreaterThan(1);
    expect(JSON.stringify(records)).not.toContain("https://");
  });

  it("writes a C2PA interop sidecar next to a signed receipt when requested", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const receiptPath = path.join(dir, "receipt.json");
    const sidecarPath = path.join(dir, "receipt.c2pa-sidecar.json");

    const signed = await signFile({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      outPath: receiptPath,
      c2paSidecarPath: sidecarPath,
      receiptReference: "https://publisher.example/receipts/notice.json",
    });

    const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
    expect(signed.c2paSidecarPath).toBe(sidecarPath);
    expect(sidecar.version).toBe("groundlock-c2pa-interop/v1");
    expect(sidecar.interopOnly).toBe(true);
    expect(sidecar.warning).toContain("not an official C2PA manifest store");
    expect(sidecar.groundlock).toEqual(
      expect.objectContaining({
        exactContentHash: signed.receipt.candidateHash,
        signerDomain: "publisher.example",
        signerKeyId: "k1",
        contentClass: "publisher-file",
        receiptReference: "https://publisher.example/receipts/notice.json",
      }),
    );
    expect(sidecar.c2paManifestProjection.created_assertions[0].url).toBe(
      "self#jumbf=/c2pa/assertions/com.groundlock.receipt.v1",
    );
  });
});

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  };
}
