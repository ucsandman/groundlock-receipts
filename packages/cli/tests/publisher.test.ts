import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateSigningKey, parseCacheManifestRecord } from "@groundlock/core";
import {
  localPublish,
  setupDomainRecords,
  signFile,
  verifyWithFixture,
} from "../src/publisher.js";
import type { SourceOfTruth } from "@groundlock/core";

const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "amount", value: "$2,000.00" }],
  extract: { money: true, dates: false, percentages: false },
};

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
