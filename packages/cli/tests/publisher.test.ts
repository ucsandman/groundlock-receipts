import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSigningKey, parseCacheManifestRecord } from "@groundlock/core";
import {
  createLaunchKit,
  formatDnsZoneRecords,
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

async function fileSha256(filePath: string): Promise<string> {
  return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("base64url")}`;
}

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
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      outPath,
    });
    expect(signed.exitCode).toBe(0);
    expect(JSON.parse(await readFile(outPath, "utf8")).verdict).toBe("pass");

    const blocked = await signFile({
      filePath: blockedPath,
      sourcePath,
      domain: "publisher.groundlock.dev",
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
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });

    expect(published.receiptPath).toContain("receipts");
    expect(published.statusPath).toContain("status");
    expect(published.fixturePath).toContain("dns-fixture.json");
    await expect(verifyWithFixture({ input: filePath, fixturePath: published.fixturePath, domain: "publisher.groundlock.dev" })).resolves.toEqual(
      expect.objectContaining({ state: "PASS" }),
    );

    const fixture = JSON.parse(await readFile(published.fixturePath, "utf8"));
    fixture.status.claim.status = "revoked";
    fixture.status.claim.reason = "test revocation";
    await writeFile(published.fixturePath, JSON.stringify(fixture, null, 2), "utf8");
    await expect(verifyWithFixture({ input: filePath, fixturePath: published.fixturePath, domain: "publisher.groundlock.dev" })).resolves.toEqual(
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
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });

    const env = await exportWebEnv({
      fixturePath: published.fixturePath,
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      siteUrl: "https://receipts.groundlock.dev/share",
    });

    expect(env).toContain("GROUNDLOCK_SIGNER_DOMAIN=publisher.groundlock.dev");
    expect(env).toContain("NEXT_PUBLIC_SITE_URL=https://receipts.groundlock.dev");
    expect(env).toContain("GROUNDLOCK_DOH_ENDPOINT=https://resolver.groundlock.dev/dns-query");
    expect(env).toContain("GROUNDLOCK_STATUS_BASE_URL=https://publisher.groundlock.dev/groundlock/status");
    expect(env).toContain("GROUNDLOCK_FETCH_TIMEOUT_MS=5000");
    expect(env).toContain("GROUNDLOCK_RATE_LIMIT_MAX=240");
    expect(env).toContain("GROUNDLOCK_RATE_LIMIT_WINDOW_MS=60000");
    expect(env).toContain("GROUNDLOCK_STATUS_RECORDS_JSON=");
    expect(env).toContain('"kind":"key"');
    expect(env).toContain('"kind":"claim"');
    expect(env).not.toContain("privateKeyJwk");
    expect(env).not.toContain("publicKeyJwk");
  });

  it("writes a launch kit that ties DNS, status, web env, and HN audit inputs together", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });
    const kitDir = path.join(dir, "launch-kit");

    const kit = await createLaunchKit({
      fixturePath: published.fixturePath,
      outDir: kitDir,
      siteUrl: "https://receipts.groundlock.dev/path",
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      fileOrHash: filePath,
      ttl: 600,
    });

    const zone = await readFile(kit.artifacts.dnsZone, "utf8");
    const webEnv = await readFile(kit.artifacts.webEnv, "utf8");
    const statusRecords = await readFile(kit.artifacts.statusRecords, "utf8");
    const summary = JSON.parse(await readFile(kit.artifacts.launchSummary, "utf8"));
    const hnReadiness = await readFile(kit.artifacts.hnReadiness, "utf8");
    const runbook = await readFile(kit.artifacts.runbook, "utf8");
    const checksums = await readFile(kit.artifacts.checksums, "utf8");

    expect(kit.contentHash).toBe(summary.contentHash);
    expect(kit.receiptHash).toBe(summary.receiptHash);
    expect(zone).toContain('_truename.publisher.groundlock.dev. 600 IN TXT "');
    expect(webEnv).toContain("NEXT_PUBLIC_SITE_URL=https://receipts.groundlock.dev");
    expect(webEnv).toContain("GROUNDLOCK_DOH_ENDPOINT=https://resolver.groundlock.dev/dns-query");
    expect(webEnv).toContain("GROUNDLOCK_FETCH_TIMEOUT_MS=5000");
    expect(webEnv).toContain("GROUNDLOCK_RATE_LIMIT_MAX=240");
    expect(webEnv).toContain("GROUNDLOCK_RATE_LIMIT_WINDOW_MS=60000");
    expect(statusRecords).toContain('"kind": "key"');
    expect(statusRecords).toContain('"kind": "claim"');
    expect(summary.schema).toBe("groundlock-launch-kit/v1");
    expect(summary.receiptVerdict).toBe("pass");
    expect(summary.receiptIssuedAt).toBeTypeOf("string");
    expect(summary.contentClass).toBe("publisher-file");
    expect(summary.fetchTimeoutMs).toBe(5000);
    expect(summary.rateLimitMax).toBe(240);
    expect(summary.rateLimitWindowMs).toBe(60000);
    expect(summary.dnsTxtRecordCount).toBeGreaterThan(0);
    expect(summary.artifacts.runbook).toBe("runbook.md");
    expect(summary.artifacts.checksums).toBe("checksums.txt");
    const checksumArtifacts = [
      ["dnsFixture", kit.artifacts.dnsFixture, "dns-fixture.json"],
      ["dnsZone", kit.artifacts.dnsZone, "dns-zone.txt"],
      ["webEnv", kit.artifacts.webEnv, "web.env"],
      ["statusRecords", kit.artifacts.statusRecords, "status-records.json"],
      ["hnReadiness", kit.artifacts.hnReadiness, "hn-readiness.ps1"],
      ["runbook", kit.artifacts.runbook, "runbook.md"],
    ] as const;
    for (const [key, filePath, fileName] of checksumArtifacts) {
      expect(summary.artifactSha256[key]).toBe(await fileSha256(filePath));
      expect(checksums).toContain(`${summary.artifactSha256[key]}  ${fileName}`);
    }
    expect(checksums).not.toContain("launch-summary.json");
    expect(hnReadiness).toContain("$CandidateRoots");
    expect(hnReadiness).toContain("$RepoRoot");
    expect(hnReadiness).toContain("Push-Location $RepoRoot");
    expect(hnReadiness).toContain("could_not_find_groundlock_repo_root");
    expect(hnReadiness).toContain("scripts\\hn_readiness.py");
    expect(hnReadiness).toContain("--launch-kit $KitDir");
    expect(hnReadiness).toContain("--evidence-out");
    expect(runbook).toContain("# GroundLock launch runbook");
    expect(runbook).toContain("groundlock warm-cache .\\dns-fixture.json");
    expect(runbook).toContain('groundlock check-live "');
    expect(runbook).toContain(".\\hn-readiness.ps1");
    expect(runbook).toContain("Repository: ucsandman/groundlock-receipts");
    expect(`${zone}\n${webEnv}\n${statusRecords}\n${JSON.stringify(summary)}\n${hnReadiness}\n${runbook}\n${checksums}`).not.toContain("privateKeyJwk");
  });

  it("refuses to create a Hacker News launch kit for a BLOCK receipt", async () => {
    const { dir, sourcePath, blockedPath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath: blockedPath,
      sourcePath,
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });

    await expect(createLaunchKit({
      fixturePath: published.fixturePath,
      outDir: path.join(dir, "launch-kit"),
      siteUrl: "https://receipts.groundlock.dev",
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      fileOrHash: blockedPath,
    })).rejects.toThrow("launch_receipt_not_pass");
  });

  it("refuses launch kits when the identity TXT key does not match the manifest key", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });
    const fixture = JSON.parse(await readFile(published.fixturePath, "utf8")) as { txt: Record<string, string[]> };
    fixture.txt["_truename.publisher.groundlock.dev"] = [fixture.txt["_truename.publisher.groundlock.dev"]![0]!.replace("kid=k1", "kid=other")];
    await writeFile(published.fixturePath, JSON.stringify(fixture), "utf8");

    await expect(createLaunchKit({
      fixturePath: published.fixturePath,
      outDir: path.join(dir, "launch-kit"),
      siteUrl: "https://receipts.groundlock.dev",
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      fileOrHash: filePath,
    })).rejects.toThrow("launch_identity_key_mismatch");
  });

  it("refuses launch kits from placeholder signer domain fixtures", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: path.join(dir, "publish"),
    });

    await expect(createLaunchKit({
      fixturePath: published.fixturePath,
      outDir: path.join(dir, "launch-kit"),
      siteUrl: "https://receipts.groundlock.dev",
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      fileOrHash: filePath,
    })).rejects.toThrow("invalid_signer_domain");
  });

  it("refuses public launch fixtures that contain private JWK material", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: path.join(dir, "publish"),
    });
    const fixture = JSON.parse(await readFile(published.fixturePath, "utf8")) as Record<string, unknown>;
    fixture.leakedSigner = { kty: "OKP", d: "private-scalar" };
    await writeFile(published.fixturePath, JSON.stringify(fixture, null, 2), "utf8");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(exportWebEnv({
      fixturePath: published.fixturePath,
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      siteUrl: "https://receipts.groundlock.dev",
    })).rejects.toThrow("launch_fixture_contains_private_key");
    await expect(warmDnsCache({
      fixturePath: published.fixturePath,
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
    })).rejects.toThrow("launch_fixture_contains_private_key");
    await expect(createLaunchKit({
      fixturePath: published.fixturePath,
      outDir: path.join(dir, "launch-kit"),
      siteUrl: "https://receipts.groundlock.dev",
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      fileOrHash: filePath,
    })).rejects.toThrow("launch_fixture_contains_private_key");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses public launch fixtures with malformed status records", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: path.join(dir, "publish"),
    });
    const fixture = JSON.parse(await readFile(published.fixturePath, "utf8")) as Record<string, unknown>;
    delete ((fixture.status as Record<string, unknown>).key as Record<string, unknown>).issuedAt;
    await writeFile(published.fixturePath, JSON.stringify(fixture, null, 2), "utf8");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(exportWebEnv({
      fixturePath: published.fixturePath,
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      siteUrl: "https://receipts.groundlock.dev",
    })).rejects.toThrow("launch_fixture_status_malformed");
    await expect(warmDnsCache({
      fixturePath: published.fixturePath,
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
    })).rejects.toThrow("launch_fixture_status_malformed");
    await expect(createLaunchKit({
      fixturePath: published.fixturePath,
      outDir: path.join(dir, "launch-kit"),
      siteUrl: "https://receipts.groundlock.dev",
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      fileOrHash: filePath,
    })).rejects.toThrow("launch_fixture_status_malformed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses public launch fixtures with unusable status records", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: path.join(dir, "publish"),
    });
    const fixture = JSON.parse(await readFile(published.fixturePath, "utf8")) as Record<string, unknown>;
    (((fixture.status as Record<string, unknown>).claim as Record<string, unknown>).subject as Record<string, unknown>).receiptHash = "not-sha256";
    await writeFile(published.fixturePath, JSON.stringify(fixture, null, 2), "utf8");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(exportWebEnv({
      fixturePath: published.fixturePath,
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      siteUrl: "https://receipts.groundlock.dev",
    })).rejects.toThrow("launch_fixture_status_mismatch");
    await expect(warmDnsCache({
      fixturePath: published.fixturePath,
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
    })).rejects.toThrow("launch_fixture_status_mismatch");
    await expect(createLaunchKit({
      fixturePath: published.fixturePath,
      outDir: path.join(dir, "launch-kit"),
      siteUrl: "https://receipts.groundlock.dev",
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      fileOrHash: filePath,
    })).rejects.toThrow("launch_fixture_status_mismatch");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to export a live web env block without an explicit DoH endpoint", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });

    const opts = {
      fixturePath: published.fixturePath,
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      siteUrl: "https://receipts.groundlock.dev/share",
    } as unknown as Parameters<typeof exportWebEnv>[0];

    await expect(exportWebEnv(opts)).rejects.toThrow("missing_doh_endpoint");
  });

  it.each([
    ["DoH endpoint", { dohEndpoint: "http://resolver.groundlock.dev/dns-query" }, "invalid_doh_endpoint"],
    ["DoH endpoint", { dohEndpoint: "https://user:pass@resolver.groundlock.dev/dns-query" }, "invalid_doh_endpoint"],
    ["DoH endpoint", { dohEndpoint: "https://bad_label.groundlock.dev/dns-query" }, "invalid_doh_endpoint"],
    ["DoH endpoint", { dohEndpoint: "https://resolver.groundlock.dev/dns-query?bootstrap=1" }, "invalid_doh_endpoint"],
    ["DoH endpoint", { dohEndpoint: "https://resolver.example/dns-query" }, "invalid_doh_endpoint"],
    ["status base URL", { statusBaseUrl: "not-url" }, "invalid_status_base_url"],
    ["status base URL", { statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status#fragment" }, "invalid_status_base_url"],
    ["status base URL", { statusBaseUrl: "https://publisher.example/groundlock/status" }, "invalid_status_base_url"],
    ["site URL", { siteUrl: "http://receipts.groundlock.dev/share" }, "invalid_site_url"],
    ["site URL", { siteUrl: "https://user:pass@receipts.groundlock.dev/share" }, "invalid_site_url"],
    ["site URL", { siteUrl: "https://bad_label.groundlock.dev/share" }, "invalid_site_url"],
    ["site URL", { siteUrl: "https://receipts.example.com/share" }, "invalid_site_url"],
  ])("refuses to export a live web env block with an invalid %s", async (_label, override, error) => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });

    await expect(exportWebEnv({
      fixturePath: published.fixturePath,
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      siteUrl: "https://receipts.groundlock.dev/share",
      ...override,
    })).rejects.toThrow(error);
  });

  it("refuses to export a live web env block from a placeholder signer domain fixture", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: path.join(dir, "publish"),
    });

    await expect(exportWebEnv({
      fixturePath: published.fixturePath,
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      siteUrl: "https://receipts.groundlock.dev/share",
    })).rejects.toThrow("invalid_signer_domain");
  });

  it("warms and validates all DNS cache fixture TXT records through DoH", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const publishDir = path.join(dir, "publish");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.groundlock.dev",
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
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
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
      domain: "publisher.groundlock.dev",
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
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: publishDir,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(warmDnsCache({
      fixturePath: published.fixturePath,
      dohEndpoint: "http://resolver.groundlock.dev/dns-query",
    })).rejects.toThrow("invalid_doh_endpoint");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to warm DNS cache for a placeholder signer domain fixture", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const published = await localPublish({
      filePath,
      sourcePath,
      domain: "publisher.example",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      publicKeyJwk: key.publicKeyJwk,
      outDir: path.join(dir, "publish"),
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(warmDnsCache({
      fixturePath: published.fixturePath,
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
    })).rejects.toThrow("invalid_signer_domain");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses live verification without an explicit DoH endpoint", async () => {
    const opts = {
      input: "sha256:abc123",
      domain: "publisher.groundlock.dev",
      statusBaseUrl: "https://publisher.groundlock.dev/groundlock/status",
    } as unknown as Parameters<typeof verifyLive>[0];

    await expect(verifyLive(opts)).rejects.toThrow("missing_doh_endpoint");
  });

  it.each([
    ["DoH endpoint", { dohEndpoint: "http://resolver.groundlock.dev/dns-query" }, "invalid_doh_endpoint"],
    ["DoH endpoint", { dohEndpoint: "https://user:pass@resolver.groundlock.dev/dns-query" }, "invalid_doh_endpoint"],
    ["DoH endpoint", { dohEndpoint: "https://bad_label.groundlock.dev/dns-query" }, "invalid_doh_endpoint"],
    ["DoH endpoint", { dohEndpoint: "https://resolver.groundlock.dev/dns-query?bootstrap=1" }, "invalid_doh_endpoint"],
    ["DoH endpoint", { dohEndpoint: "https://resolver.example/dns-query" }, "invalid_doh_endpoint"],
    ["status base URL", { statusBaseUrl: "not-url" }, "invalid_status_base_url"],
    ["status base URL", { statusBaseUrl: "https://status.groundlock.dev/groundlock#fragment" }, "invalid_status_base_url"],
    ["status base URL", { statusBaseUrl: "https://status.example/groundlock" }, "invalid_status_base_url"],
  ])("refuses live verification with an invalid %s", async (_label, override, error) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(verifyLive({
      input: "sha256:abc123",
      domain: "publisher.groundlock.dev",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      statusBaseUrl: "https://status.groundlock.dev/groundlock",
      ...override,
    })).rejects.toThrow(error);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses live verification for a placeholder signer domain before network calls", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(verifyLive({
      input: "sha256:abc123",
      domain: "publisher.example",
      dohEndpoint: "https://resolver.groundlock.dev/dns-query",
      statusBaseUrl: "https://status.groundlock.dev/groundlock",
    })).rejects.toThrow("invalid_signer_domain");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("prints DNS cache records without HTTPS receipt storage or DNS mutation", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const signed = await signFile({
      filePath,
      sourcePath,
      domain: "publisher.groundlock.dev",
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
    expect(records.identity.name).toBe("_truename.publisher.groundlock.dev");
    expect(records.manifest.name).toContain("._groundlock.publisher.groundlock.dev");
    expect(parseCacheManifestRecord(records.manifest.value)).toEqual(
      expect.objectContaining({ signerDomain: "publisher.groundlock.dev", kid: "k1", chunkCount: records.chunks.length }),
    );
    expect(records.chunks.length).toBeGreaterThan(1);
    expect(JSON.stringify(records)).not.toContain("https://");
  });

  it("formats DNS cache records as pasteable zone-file TXT lines", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const signed = await signFile({
      filePath,
      sourcePath,
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      outPath: path.join(dir, "receipt.json"),
    });
    const records = setupDomainRecords({
      receipt: signed.receipt,
      publicKeyJwk: key.publicKeyJwk,
      chunkSize: 80,
    });

    const zone = formatDnsZoneRecords(records, 600);

    expect(zone).toContain('_truename.publisher.groundlock.dev. 600 IN TXT "');
    expect(zone).toContain("._groundlock.publisher.groundlock.dev. 600 IN TXT ");
    expect(zone).toContain("c0.");
    expect(zone).not.toContain("privateKeyJwk");
    for (const line of zone.trim().split("\n")) {
      expect(line).toMatch(/\. 600 IN TXT ".*"$/);
      for (const segment of line.match(/"([^"]*)"/g) ?? []) {
        expect(segment.length).toBeLessThanOrEqual(257);
      }
    }
    expect(() => formatDnsZoneRecords(records, 0)).toThrow("invalid_ttl");
  });

  it("writes a C2PA interop sidecar next to a signed receipt when requested", async () => {
    const { dir, sourcePath, filePath } = await fixtureDir();
    const key = generateSigningKey("k1");
    const receiptPath = path.join(dir, "receipt.json");
    const sidecarPath = path.join(dir, "receipt.c2pa-sidecar.json");

    const signed = await signFile({
      filePath,
      sourcePath,
      domain: "publisher.groundlock.dev",
      kid: key.kid,
      privateKeyJwk: key.privateKeyJwk,
      outPath: receiptPath,
      c2paSidecarPath: sidecarPath,
      receiptReference: "https://publisher.groundlock.dev/receipts/notice.json",
    });

    const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
    expect(signed.c2paSidecarPath).toBe(sidecarPath);
    expect(sidecar.version).toBe("groundlock-c2pa-interop/v1");
    expect(sidecar.interopOnly).toBe(true);
    expect(sidecar.warning).toContain("not an official C2PA manifest store");
    expect(sidecar.groundlock).toEqual(
      expect.objectContaining({
        exactContentHash: signed.receipt.candidateHash,
        signerDomain: "publisher.groundlock.dev",
        signerKeyId: "k1",
        contentClass: "publisher-file",
        receiptReference: "https://publisher.groundlock.dev/receipts/notice.json",
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
