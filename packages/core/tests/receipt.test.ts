import { describe, it, expect } from "vitest";
import { issueReceipt, verifyReceipt, ENGINE_VERSION } from "../src/receipt";
import { generateSigningKey } from "../src/keys";
import { verify } from "../src/verify";
import type { SourceOfTruth } from "../src/types";

const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "tenant", value: "Jane Roe" }],
  extract: { money: false, dates: false, percentages: false },
};
const candidate = "Dear Jane Roe, this is a notice.";
const issuedAt = "2026-06-01T00:00:00.000Z";

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
});
