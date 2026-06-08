import { describe, it, expect } from "vitest";
import { issueReceipt, issueVerifiedReceipt, verifyReceipt, ENGINE_VERSION } from "../src/receipt";
import { generateSigningKey } from "../src/keys";
import { traceGrounding, verify } from "../src/verify";
import type { ProofReceipt, SourceOfTruth } from "../src/types";

const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "tenant", value: "Jane Roe" }],
  extract: { money: false, dates: false, percentages: false },
};
const candidate = "Dear Jane Roe, this is a notice.";
const issuedAt = "2026-06-01T00:00:00.000Z";

const richSource: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [
    { label: "withheld", value: "$2,000.00" },
    { label: "dueDate", value: "June 1, 2026" },
    { label: "rate", value: "7.5%" },
    { label: "invoice", value: "Invoice 10012" },
  ],
  extract: {
    money: true,
    dates: true,
    percentages: true,
    patterns: [{ label: "invoice", pattern: "\\b\\d{5}\\b" }],
  },
};
const richCandidate =
  "Dear Jane Roe, return $2,000.00 by June 1, 2026 with 7.5% interest. Invoice 10012 applies.";

describe("receipt", () => {
  it("issues a receipt that round-trips verification and strips violation detail", () => {
    const kp = generateSigningKey("k1");
    const result = verify(candidate, source);
    const receipt = issueReceipt(result, candidate, source, { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk }, issuedAt);

    expect(receipt.version).toBe("groundlock-receipt/v1");
    expect(receipt.engineVersion).toBe(ENGINE_VERSION);
    expect(receipt.verdict).toBe("pass");
    expect(receipt.signature.alg).toBe("EdDSA");
    expect(receipt.candidateHash).toMatch(/^sha256:/);
    // privacy: receipt violations never carry a raw detail field
    expect(receipt.violations.every((v) => !("detail" in v))).toBe(true);

    expect(verifyReceipt(receipt, kp.publicKeyJwk)).toEqual({ ok: true });
  });

  it("fails verification when any field is tampered", () => {
    const kp = generateSigningKey("k1");
    const receipt = issueReceipt(verify(candidate, source), candidate, source, { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk }, issuedAt);

    const tampered = { ...receipt, verdict: "block" as const };
    expect(verifyReceipt(tampered, kp.publicKeyJwk).ok).toBe(false);

    const tampered2 = { ...receipt, candidateHash: "sha256:deadbeef" };
    expect(verifyReceipt(tampered2, kp.publicKeyJwk).ok).toBe(false);
  });

  it("fails closed on a malformed receipt", () => {
    const kp = generateSigningKey("k1");
    // @ts-expect-error intentionally malformed
    expect(verifyReceipt({ nonsense: true }, kp.publicKeyJwk).ok).toBe(false);
  });

  it("issues a rich receipt body for public verification", () => {
    const kp = generateSigningKey("k1");
    const receipt = issueReceipt(
      verify(richCandidate, richSource),
      richCandidate,
      richSource,
      { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk },
      issuedAt,
      {
        signerDomain: "publisher.example",
        contentClass: "tenant-notice",
        canonicalOriginalUrl: "HTTPS://Publisher.Example/letters/notice-1",
        revocationPointer: "https://publisher.example/.well-known/groundlock/status/notice-1.json",
      },
    );

    expect(receipt.signerKeyId).toBe("k1");
    expect(receipt.signerDomain).toBe("publisher.example");
    expect(receipt.contentClass).toBe("tenant-notice");
    expect(receipt.sourceHash).toBe(receipt.sourceOfTruthHash);
    expect(receipt.contentHashes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "candidate", alg: "sha256", value: receipt.candidateHash }),
        expect.objectContaining({ role: "source", alg: "sha256", value: receipt.sourceHash }),
      ]),
    );
    expect(receipt.canonicalOriginalUrl).toBe("https://publisher.example/letters/notice-1");
    expect(receipt.revocationPointer).toContain("/status/notice-1.json");
    expect(receipt.issuedAt).toBe(issuedAt);
    expect(receipt.groundedClaims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "money",
          token: "$2,000.00",
          normalized: "2000",
          sourceLabel: "withheld",
          sourceValue: "$2,000.00",
        }),
        expect.objectContaining({
          kind: "date",
          token: "June 1, 2026",
          normalized: "2026-06-01",
          sourceLabel: "dueDate",
          sourceValue: "June 1, 2026",
        }),
        expect.objectContaining({
          kind: "percentage",
          token: "7.5%",
          normalized: "7.5",
          sourceLabel: "rate",
          sourceValue: "7.5%",
        }),
        expect.objectContaining({
          kind: "pattern",
          token: "10012",
          normalized: "10012",
          sourceLabel: "invoice",
          sourceValue: "Invoice 10012",
        }),
      ]),
    );
    expect(verifyReceipt(receipt, kp.publicKeyJwk)).toEqual({ ok: true });
  });

  it("signs every rich receipt body field except the signature", () => {
    const kp = generateSigningKey("k1");
    const receipt = issueReceipt(
      verify(richCandidate, richSource),
      richCandidate,
      richSource,
      { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk },
      issuedAt,
      { signerDomain: "publisher.example", contentClass: "tenant-notice" },
    );

    const tamperedDomain = { ...receipt, signerDomain: "attacker.example" };
    expect(verifyReceipt(tamperedDomain, kp.publicKeyJwk)).toEqual({
      ok: false,
      reason: "bad_signature",
    });

    const tamperedClaims = {
      ...receipt,
      groundedClaims: receipt.groundedClaims.map((claim) =>
        claim.kind === "money" ? { ...claim, sourceValue: "$9,999.00" } : claim,
      ),
    };
    expect(verifyReceipt(tamperedClaims, kp.publicKeyJwk)).toEqual({
      ok: false,
      reason: "bad_signature",
    });

    const resignedSignatureOnly = { ...receipt, signature: { ...receipt.signature } };
    expect(verifyReceipt(resignedSignatureOnly, kp.publicKeyJwk)).toEqual({ ok: true });
  });

  it("issues a signed BLOCK receipt for ungrounded operational tokens", () => {
    const kp = generateSigningKey("k1");
    const blocked = issueVerifiedReceipt(
      richCandidate + " Add a $99.00 fee on July 9, 2026 at 12%. Ref 55555.",
      richSource,
      { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk },
      issuedAt,
      { signerDomain: "publisher.example", contentClass: "tenant-notice" },
    );

    expect(blocked.verdict).toBe("block");
    expect(blocked.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "fabricated_fact", label: "money" }),
        expect.objectContaining({ code: "fabricated_fact", label: "date" }),
        expect.objectContaining({ code: "fabricated_fact", label: "percentage" }),
        expect.objectContaining({ code: "fabricated_fact", label: "invoice" }),
      ]),
    );
    expect(blocked.signature.sig).toEqual(expect.any(String));
    expect(verifyReceipt(blocked, kp.publicKeyJwk)).toEqual({ ok: true });
  });

  it("derives grounded claim summaries from the core trace output", () => {
    const kp = generateSigningKey("k1");
    const receipt = issueReceipt(
      verify(richCandidate, richSource),
      richCandidate,
      richSource,
      { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk },
      issuedAt,
      { signerDomain: "publisher.example", contentClass: "tenant-notice" },
    );
    const trace = traceGrounding(richCandidate, richSource);

    expect(trace.ungrounded).toEqual([]);
    expect(receipt.groundedClaims).toEqual(trace.groundedClaims);
  });

  it("fails closed on unsupported versions and missing rich receipt fields", () => {
    const kp = generateSigningKey("k1");
    const receipt = issueReceipt(
      verify(richCandidate, richSource),
      richCandidate,
      richSource,
      { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk },
      issuedAt,
      { signerDomain: "publisher.example", contentClass: "tenant-notice" },
    );

    expect(
      verifyReceipt({ ...receipt, version: "groundlock-receipt/v0" } as unknown as ProofReceipt, kp.publicKeyJwk),
    ).toEqual({ ok: false, reason: "unsupported_version" });

    const missingDomain = { ...receipt };
    delete (missingDomain as Partial<ProofReceipt>).signerDomain;
    expect(verifyReceipt(missingDomain, kp.publicKeyJwk)).toEqual({
      ok: false,
      reason: "missing_required_field",
    });

    const missingSourceHash = { ...receipt };
    delete (missingSourceHash as Partial<ProofReceipt>).sourceHash;
    expect(verifyReceipt(missingSourceHash, kp.publicKeyJwk)).toEqual({
      ok: false,
      reason: "missing_required_field",
    });
  });

  it("fails closed on internally inconsistent PASS receipts with violations", () => {
    const kp = generateSigningKey("k1");
    const receipt = issueReceipt(
      {
        verdict: "pass",
        violations: [{ code: "fabricated_fact", label: "amount", detail: "$99.00" }],
      },
      richCandidate,
      richSource,
      { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk },
      issuedAt,
      { signerDomain: "publisher.example", contentClass: "tenant-notice" },
    );

    expect(verifyReceipt(receipt, kp.publicKeyJwk)).toEqual({
      ok: false,
      reason: "verdict_violation_mismatch",
    });
  });
});
