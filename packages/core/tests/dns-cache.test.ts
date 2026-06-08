import { describe, expect, it } from "vitest";
import { generateSigningKey } from "../src/keys";
import { issueVerifiedReceipt } from "../src/receipt";
import {
  createClaimStatusRecord,
  createKeyStatusRecord,
  receiptStatusHash,
  type StatusResolver,
} from "../src/status";
import {
  cacheChunkName,
  contentHashToDnsName,
  createDnsCacheRecords,
  createLocalTrueNameResolver,
  parseCacheChunkRecord,
  parseCacheManifestRecord,
  verifyTrueName,
} from "../src/truename";
import type { ProofReceipt, SourceOfTruth } from "../src/types";
import type { DnsCacheRecords } from "../src/truename";

const issuedAt = "2026-06-08T00:00:00.000Z";
const signerDomain = "publisher.example";
const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "amount", value: "$2,000.00" }],
  extract: { money: true, dates: false, percentages: false },
};

function signedReceipt() {
  const key = generateSigningKey("k1");
  const receipt = issueVerifiedReceipt(
    "Dear Jane Roe, return $2,000.00.",
    source,
    { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
    issuedAt,
    { signerDomain, contentClass: "tenant-notice" },
  );
  return { key, receipt };
}

function activeStatusResolver(receipt: ProofReceipt): StatusResolver {
  const keyRecord = createKeyStatusRecord({
    signerDomain: receipt.signerDomain,
    kid: receipt.signerKeyId,
    status: "active",
    issuedAt,
  });
  const claimRecord = createClaimStatusRecord({
    receiptHash: receiptStatusHash(receipt),
    status: "active",
    issuedAt,
  });
  return {
    resolveKeyStatus: async () => ({ type: "found", record: keyRecord }),
    resolveClaimStatus: async () => ({ type: "found", record: claimRecord }),
  };
}

function txtFromRecords(records: DnsCacheRecords): Record<string, string[]> {
  const txt: Record<string, string[]> = {
    [records.identity.name]: [records.identity.value],
    [records.manifest.name]: [records.manifest.value],
  };
  for (const chunk of records.chunks) {
    txt[chunk.name] = [chunk.value];
  }
  return txt;
}

describe("DNS cache receipt records", () => {
  it("chunks the full signed receipt into TXT records without HTTPS receipt storage", () => {
    const { key, receipt } = signedReceipt();
    const records = createDnsCacheRecords(receipt, key.publicKeyJwk, { chunkSize: 80 });

    expect(records.manifest.name).toBe(contentHashToDnsName(receipt.candidateHash, signerDomain));
    expect(records.manifest.value).not.toContain("url=");
    expect(records.manifest.value).not.toContain("https://");
    expect(parseCacheManifestRecord(records.manifest.value)).toEqual(
      expect.objectContaining({
        version: "gdm1",
        receiptHash: receiptStatusHash(receipt),
        signerDomain,
        kid: receipt.signerKeyId,
        chunkCount: records.chunks.length,
      }),
    );

    expect(records.chunks.length).toBeGreaterThan(1);
    for (const chunk of records.chunks) {
      expect(chunk.name).toMatch(/^c\d+\.gl-[a-zA-Z0-9_-]+\._groundlock\.publisher\.example$/);
      expect(chunk.value.length).toBeLessThanOrEqual(255);
      expect(parseCacheChunkRecord(chunk.value)).toEqual(
        expect.objectContaining({ version: "gdc1", index: chunk.index }),
      );
    }
  });

  it("verifies by reconstructing the receipt from DNS cache TXT chunks only", async () => {
    const { key, receipt } = signedReceipt();
    const records = createDnsCacheRecords(receipt, key.publicKeyJwk, { chunkSize: 80 });
    const txt = txtFromRecords(records);

    await expect(
      verifyTrueName(
        receipt.candidateHash,
        signerDomain,
        createLocalTrueNameResolver({ txt, statusResolver: activeStatusResolver(receipt) }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        state: "PASS",
        code: "verified",
        explanation: expect.stringContaining("DNS cache"),
      }),
    );
  });

  it("fails closed when a cached chunk is missing or tampered", async () => {
    const { key, receipt } = signedReceipt();
    const records = createDnsCacheRecords(receipt, key.publicKeyJwk, { chunkSize: 80 });
    const txt = txtFromRecords(records);
    delete txt[cacheChunkName(receipt.candidateHash, signerDomain, 0)];

    await expect(
      verifyTrueName(
        receipt.candidateHash,
        signerDomain,
        createLocalTrueNameResolver({ txt, statusResolver: activeStatusResolver(receipt) }),
      ),
    ).resolves.toEqual(expect.objectContaining({ state: "UNVERIFIABLE", code: "dns_cache_chunk_missing" }));

    const tamperedTxt = txtFromRecords(records);
    const firstChunk = records.chunks[0];
    expect(firstChunk).toBeDefined();
    tamperedTxt[firstChunk!.name] = ["gdc1 i=0 d=tampered"];

    await expect(
      verifyTrueName(
        receipt.candidateHash,
        signerDomain,
        createLocalTrueNameResolver({ txt: tamperedTxt, statusResolver: activeStatusResolver(receipt) }),
      ),
    ).resolves.toEqual(expect.objectContaining({ state: "UNVERIFIABLE", code: "dns_cache_payload_hash_mismatch" }));
  });
});
