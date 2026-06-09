import { sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalizeJson, digestText } from "../src/canonicalize";
import { generateSigningKey, privateKeyFromJwk, type KeyPairJwk } from "../src/keys";
import { issueVerifiedReceipt, TEXT_CANONICALIZATION } from "../src/receipt";
import {
  createClaimStatusRecord,
  createKeyStatusRecord,
  receiptStatusHash,
  type StatusLookupResult,
  type StatusResolver,
} from "../src/status";
import {
  createDnsCacheRecords,
  createDohTxtResolver,
  createLocalTrueNameResolver,
  cacheChunkName,
  contentHashToDnsName,
  formatCacheManifestRecord,
  formatIdentityRecord,
  parseCacheManifestRecord,
  truenameIdentityName,
  verifyTrueName,
  type DnsCacheRecords,
} from "../src/truename";
import type { ProofReceipt, SourceOfTruth } from "../src/types";

const issuedAt = "2026-06-08T00:00:00.000Z";
const signerDomain = "publisher.example";
const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "amount", value: "$2,000.00" }],
  extract: { money: true, dates: false, percentages: false },
};

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

function signedReceipt(text = "Dear Jane Roe, return $2,000.00.") {
  const key = generateSigningKey("k1");
  const receipt = issueVerifiedReceipt(
    text,
    source,
    { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
    issuedAt,
    { signerDomain, contentClass: "tenant-notice" },
  );
  return { key, receipt };
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

function fixtureFor(receipt: ProofReceipt, publicKeyJwk: JsonWebKey, statusResolver = activeStatusResolver(receipt)) {
  return createLocalTrueNameResolver({
    txt: txtFromRecords(createDnsCacheRecords(receipt, publicKeyJwk, { chunkSize: 80 })),
    statusResolver,
  });
}

function resignReceipt(receipt: ProofReceipt, key: KeyPairJwk): ProofReceipt {
  const { signature: _signature, ...base } = receipt;
  const sig = cryptoSign(null, Buffer.from(canonicalizeJson(base), "utf8"), privateKeyFromJwk(key.privateKeyJwk));
  return { ...base, signature: { alg: "EdDSA", kid: key.kid, sig: sig.toString("base64url") } };
}

describe("TrueName DNS cache resolver state machine", () => {
  it("returns PASS for a DNSSEC-backed cached receipt, identity record, signature, and active statuses", async () => {
    const { key, receipt } = signedReceipt();
    await expect(verifyTrueName(receipt.candidateHash, signerDomain, fixtureFor(receipt, key.publicKeyJwk))).resolves.toEqual(
      expect.objectContaining({
        state: "PASS",
        code: "verified",
        explanation: expect.stringContaining("DNS cache"),
      }),
    );
  });

  it("validates identity key reference before reconstructing trust", async () => {
    const { key, receipt } = signedReceipt();
    const records = createDnsCacheRecords(receipt, key.publicKeyJwk, { chunkSize: 80 });
    const manifest = parseCacheManifestRecord(records.manifest.value);
    const txt = txtFromRecords(records);
    txt[records.manifest.name] = [
      formatCacheManifestRecord({
        ...manifest,
        kid: "wrong-kid",
      }),
    ];

    await expect(
      verifyTrueName(
        receipt.candidateHash,
        signerDomain,
        createLocalTrueNameResolver({ txt, statusResolver: activeStatusResolver(receipt) }),
      ),
    ).resolves.toEqual(expect.objectContaining({ state: "UNVERIFIABLE", code: "identity_key_mismatch" }));
  });

  it("returns UNVERIFIABLE when the DoH DNSSEC AD signal is absent", async () => {
    const doh = createDohTxtResolver(async () => ({
      ok: true,
      json: async () => ({ Status: 0, AD: false, Answer: [{ type: 16, data: '"gdm1 rh=abc ph=def n=1 key=publisher.example#k1"' }] }),
    }));

    await expect(doh.resolveTxt("anything.example")).resolves.toEqual(
      expect.objectContaining({ type: "unverifiable", code: "dnssec_not_validated" }),
    );
  });

  it("requires DNSSEC validation for found manifest, identity, and chunk TXT records", async () => {
    const { key, receipt } = signedReceipt();
    const resolver = fixtureFor(receipt, key.publicKeyJwk);
    const baseResolve = resolver.resolveTxt;
    resolver.resolveTxt = async (name) => {
      const result = await baseResolve(name);
      return result.type === "found" ? { ...result, dnssecValidated: false } : result;
    };

    await expect(verifyTrueName(receipt.candidateHash, signerDomain, resolver)).resolves.toEqual(
      expect.objectContaining({ state: "UNVERIFIABLE", code: "dnssec_not_validated" }),
    );
  });

  it("returns UNVERIFIABLE for ambiguous DNS cache manifest or identity TXT sets", async () => {
    const { key, receipt } = signedReceipt();
    const records = createDnsCacheRecords(receipt, key.publicKeyJwk, { chunkSize: 80 });
    const manifest = parseCacheManifestRecord(records.manifest.value);
    const txt = txtFromRecords(records);
    txt[records.manifest.name] = [
      records.manifest.value,
      formatCacheManifestRecord({ ...manifest, receiptHash: "sha256:conflicting" }),
    ];

    await expect(
      verifyTrueName(
        receipt.candidateHash,
        signerDomain,
        createLocalTrueNameResolver({ txt, statusResolver: activeStatusResolver(receipt) }),
      ),
    ).resolves.toEqual(expect.objectContaining({ state: "UNVERIFIABLE", code: "cache_manifest_ambiguous" }));

    const identityAmbiguousTxt = txtFromRecords(records);
    identityAmbiguousTxt[truenameIdentityName(signerDomain)] = [
      records.identity.value,
      formatIdentityRecord({ kid: "other-kid", publicKeyJwk: key.publicKeyJwk }),
    ];
    await expect(
      verifyTrueName(
        receipt.candidateHash,
        signerDomain,
        createLocalTrueNameResolver({ txt: identityAmbiguousTxt, statusResolver: activeStatusResolver(receipt) }),
      ),
    ).resolves.toEqual(expect.objectContaining({ state: "UNVERIFIABLE", code: "identity_ambiguous" }));
  });

  it("returns UNVERIFIABLE when cached manifest hash and reconstructed receipt hash differ", async () => {
    const { key, receipt } = signedReceipt();
    const records = createDnsCacheRecords(receipt, key.publicKeyJwk, { chunkSize: 80 });
    const manifest = parseCacheManifestRecord(records.manifest.value);
    const txt = txtFromRecords(records);
    txt[records.manifest.name] = [
      formatCacheManifestRecord({
        ...manifest,
        receiptHash: "sha256:not-the-real-receipt",
      }),
    ];

    await expect(
      verifyTrueName(
        receipt.candidateHash,
        signerDomain,
        createLocalTrueNameResolver({ txt, statusResolver: activeStatusResolver(receipt) }),
      ),
    ).resolves.toEqual(expect.objectContaining({ state: "UNVERIFIABLE", code: "receipt_hash_mismatch" }));
  });

  it("binds verification to the receipt candidateHash, not an extra candidate content hash", async () => {
    const { key, receipt } = signedReceipt();
    const aliasHash = digestText("A different message for the same signer.");
    const aliasedReceipt = resignReceipt(
      {
        ...receipt,
        contentHashes: [
          ...receipt.contentHashes,
          { role: "candidate", alg: "sha256", value: aliasHash, canonicalization: TEXT_CANONICALIZATION },
        ],
      },
      key,
    );
    const records = createDnsCacheRecords(aliasedReceipt, key.publicKeyJwk, { chunkSize: 80 });
    const txt = txtFromRecords(records);
    txt[contentHashToDnsName(aliasHash, signerDomain)] = [records.manifest.value];
    for (const chunk of records.chunks) {
      txt[cacheChunkName(aliasHash, signerDomain, chunk.index)] = [chunk.value];
    }

    await expect(
      verifyTrueName(
        aliasHash,
        signerDomain,
        createLocalTrueNameResolver({ txt, statusResolver: activeStatusResolver(aliasedReceipt) }),
      ),
    ).resolves.toEqual(expect.objectContaining({ state: "UNVERIFIABLE", code: "content_hash_mismatch" }));
  });

  it("returns UNVERIFIABLE for a bad signature and for status resolver exceptions", async () => {
    const { key, receipt } = signedReceipt();
    const badSignature = { ...receipt, signature: { ...receipt.signature, sig: "bad" } };
    await expect(verifyTrueName(receipt.candidateHash, signerDomain, fixtureFor(badSignature, key.publicKeyJwk))).resolves.toEqual(
      expect.objectContaining({ state: "UNVERIFIABLE", code: "signature_invalid" }),
    );

    const throwingStatus: StatusResolver = {
      resolveKeyStatus: async () => {
        throw new Error("status boom");
      },
      resolveClaimStatus: activeStatusResolver(receipt).resolveClaimStatus,
    };
    await expect(verifyTrueName(receipt.candidateHash, signerDomain, fixtureFor(receipt, key.publicKeyJwk, throwingStatus))).resolves.toEqual(
      expect.objectContaining({ state: "UNVERIFIABLE", code: "status_unverifiable" }),
    );
  });

  it("sends the JSON DNS Accept header and treats malformed DoH JSON as unverifiable", async () => {
    const doh = createDohTxtResolver(async (_url, init?: { headers?: Record<string, string> }) => {
      expect(init?.headers?.Accept).toBe("application/dns-json");
      return { ok: true, json: async () => null };
    });

    await expect(doh.resolveTxt("anything.example")).resolves.toEqual(
      expect.objectContaining({ type: "unverifiable", code: "doh_malformed" }),
    );
  });

  it("returns BLOCK for a signed blocked receipt and REVOKED for revoked status", async () => {
    const { key, receipt: blocked } = signedReceipt("Dear Jane Roe, return $2,000.00 plus a $99.00 fee.");
    await expect(verifyTrueName(blocked.candidateHash, signerDomain, fixtureFor(blocked, key.publicKeyJwk))).resolves.toEqual(
      expect.objectContaining({ state: "BLOCK", code: "receipt_blocked" }),
    );

    const { key: passKey, receipt } = signedReceipt();
    const revokedClaim = createClaimStatusRecord({
      receiptHash: receiptStatusHash(receipt),
      status: "revoked",
      reason: "publisher revoked claim",
      issuedAt,
    });
    const statusResolver: StatusResolver = {
      resolveKeyStatus: activeStatusResolver(receipt).resolveKeyStatus,
      resolveClaimStatus: async (): Promise<StatusLookupResult> => ({ type: "found", record: revokedClaim }),
    };

    await expect(verifyTrueName(receipt.candidateHash, signerDomain, fixtureFor(receipt, passKey.publicKeyJwk, statusResolver))).resolves.toEqual(
      expect.objectContaining({ state: "REVOKED", code: "status_revoked" }),
    );
  });
});
