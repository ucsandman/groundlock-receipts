import { describe, expect, it } from "vitest";
import { generateSigningKey } from "../src/keys";
import { issueVerifiedReceipt } from "../src/receipt";
import {
  createClaimStatusRecord,
  createKeyStatusRecord,
  privateClaimStatusLookup,
  privateKeyStatusLookup,
  publicClaimStatusLookup,
  publicKeyStatusLookup,
  receiptStatusHash,
  statusRecordHash,
  verifyReceiptWithStatus,
  type StatusLookupResult,
  type StatusResolver,
} from "../src/status";
import type { SourceOfTruth } from "../src/types";

const issuedAt = "2026-06-08T00:00:00.000Z";
const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "amount", value: "$2,000.00" }],
  extract: { money: true, dates: false, percentages: false },
};
const candidate = "Dear Jane Roe, return $2,000.00.";

function signedPassReceipt() {
  const key = generateSigningKey("k1");
  const receipt = issueVerifiedReceipt(
    candidate,
    source,
    { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
    issuedAt,
    { signerDomain: "publisher.example", contentClass: "tenant-notice" },
  );
  return { key, receipt };
}

function resolverWith(keyResult: StatusLookupResult, claimResult: StatusLookupResult): StatusResolver {
  return {
    resolveKeyStatus: async () => keyResult,
    resolveClaimStatus: async () => claimResult,
  };
}

describe("status records and privacy lookups", () => {
  it("requires active key and claim status before returning PASS", async () => {
    const { key, receipt } = signedPassReceipt();
    const keyStatus = createKeyStatusRecord({
      signerDomain: receipt.signerDomain,
      kid: receipt.signerKeyId,
      status: "active",
      issuedAt,
    });
    const claimStatus = createClaimStatusRecord({
      receiptHash: receiptStatusHash(receipt),
      status: "active",
      issuedAt,
    });

    expect(statusRecordHash(keyStatus)).toMatch(/^sha256:/);
    expect(statusRecordHash(claimStatus)).toMatch(/^sha256:/);
    await expect(
      verifyReceiptWithStatus(receipt, key.publicKeyJwk, resolverWith({ type: "found", record: keyStatus }, { type: "found", record: claimStatus })),
    ).resolves.toEqual(expect.objectContaining({ state: "PASS" }));
  });

  it("returns REVOKED for revoked, retracted, and compromised status", async () => {
    const { key, receipt } = signedPassReceipt();
    const activeKey = createKeyStatusRecord({
      signerDomain: receipt.signerDomain,
      kid: receipt.signerKeyId,
      status: "active",
      issuedAt,
    });
    const activeClaim = createClaimStatusRecord({
      receiptHash: receiptStatusHash(receipt),
      status: "active",
      issuedAt,
    });

    const compromisedKey = createKeyStatusRecord({
      signerDomain: receipt.signerDomain,
      kid: receipt.signerKeyId,
      status: "compromised",
      reason: "publisher reported key exposure",
      issuedAt,
    });
    await expect(
      verifyReceiptWithStatus(receipt, key.publicKeyJwk, resolverWith({ type: "found", record: compromisedKey }, { type: "found", record: activeClaim })),
    ).resolves.toEqual(expect.objectContaining({ state: "REVOKED", reason: expect.stringContaining("compromised") }));

    for (const status of ["revoked", "retracted"] as const) {
      const claimStatus = createClaimStatusRecord({
        receiptHash: receiptStatusHash(receipt),
        status,
        reason: `${status} by publisher`,
        issuedAt,
      });
      await expect(
        verifyReceiptWithStatus(receipt, key.publicKeyJwk, resolverWith({ type: "found", record: activeKey }, { type: "found", record: claimStatus })),
      ).resolves.toEqual(expect.objectContaining({ state: "REVOKED", reason: expect.stringContaining(status) }));
    }
  });

  it("returns UNVERIFIABLE for missing, unreachable, or malformed status", async () => {
    const { key, receipt } = signedPassReceipt();
    const activeKey = createKeyStatusRecord({
      signerDomain: receipt.signerDomain,
      kid: receipt.signerKeyId,
      status: "active",
      issuedAt,
    });

    for (const claimResult of [
      { type: "missing" },
      { type: "unreachable", reason: "resolver timeout" },
      { type: "malformed", reason: "bad json" },
    ] satisfies StatusLookupResult[]) {
      await expect(
        verifyReceiptWithStatus(receipt, key.publicKeyJwk, resolverWith({ type: "found", record: activeKey }, claimResult)),
      ).resolves.toEqual(expect.objectContaining({ state: "UNVERIFIABLE" }));
    }

    const malformedActiveClaim = {
      version: "groundlock-status/v1",
      kind: "claim",
      subject: { receiptHash: receiptStatusHash(receipt) },
      status: "expired",
      issuedAt,
    } as unknown as ReturnType<typeof createClaimStatusRecord>;
    await expect(
      verifyReceiptWithStatus(receipt, key.publicKeyJwk, resolverWith({ type: "found", record: activeKey }, { type: "found", record: malformedActiveClaim })),
    ).resolves.toEqual(expect.objectContaining({ state: "UNVERIFIABLE", reason: "claim_status_malformed" }));

    const malformedSubject = {
      version: "groundlock-status/v1",
      kind: "claim",
      subject: null,
      status: "active",
      issuedAt,
    } as unknown as ReturnType<typeof createClaimStatusRecord>;
    await expect(
      verifyReceiptWithStatus(receipt, key.publicKeyJwk, resolverWith({ type: "found", record: activeKey }, { type: "found", record: malformedSubject })),
    ).resolves.toEqual(expect.objectContaining({ state: "UNVERIFIABLE", reason: "claim_status_malformed" }));
  });

  it("keeps public hash lookup helpers separate from private HMAC helpers", () => {
    const { receipt } = signedPassReceipt();
    const receiptHash = receiptStatusHash(receipt);

    const publicClaim = publicClaimStatusLookup(receiptHash);
    const publicKey = publicKeyStatusLookup(receipt.signerDomain, receipt.signerKeyId);
    const privateClaim = privateClaimStatusLookup(receiptHash, {
      secret: "dummy-private-secret",
      salt: "dummy-salt",
    });
    const privateKey = privateKeyStatusLookup(receipt.signerDomain, receipt.signerKeyId, {
      secret: "dummy-private-secret",
      salt: "dummy-salt",
    });

    expect(publicClaim.mode).toBe("public");
    expect(publicClaim.lookupKey).toContain(receiptHash);
    expect(publicKey.mode).toBe("public");
    expect(privateClaim.mode).toBe("private");
    expect(privateClaim.lookupKey).toMatch(/^hmac-sha256:/);
    expect(privateClaim.lookupKey).not.toContain(receiptHash);
    expect(privateKey.lookupKey).toMatch(/^hmac-sha256:/);
  });

  it("does not allow private lookups to use public DNS unless explicitly requested", () => {
    const { receipt } = signedPassReceipt();
    const implicitPrivate = privateClaimStatusLookup(receiptStatusHash(receipt), {
      secret: "dummy-private-secret",
      salt: "dummy-salt",
    });
    const explicitPublicAllowed = privateClaimStatusLookup(receiptStatusHash(receipt), {
      secret: "dummy-private-secret",
      salt: "dummy-salt",
      allowPublicResolver: true,
    });

    expect(implicitPrivate.publicResolverAllowed).toBe(false);
    expect(explicitPublicAllowed.publicResolverAllowed).toBe(true);
  });
});
