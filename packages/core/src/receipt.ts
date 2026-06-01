import { sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { canonicalizeJson, digestText } from "./canonicalize";
import { hashSourceOfTruth } from "./ruleset";
import { privateKeyFromJwk, publicKeyFromJwk } from "./keys";
import type { ProofReceipt, SigningKey, SourceOfTruth, VerifyResult } from "./types";

export const ENGINE_VERSION = "0.1.0";

export function issueReceipt(
  result: VerifyResult,
  candidate: string,
  source: SourceOfTruth,
  key: SigningKey,
  issuedAt: string,
): ProofReceipt {
  const base = {
    version: "groundlock-receipt/v1" as const,
    issuedAt,
    engineVersion: ENGINE_VERSION,
    verdict: result.verdict,
    violations: result.violations.map((v) => ({ code: v.code, label: v.label })),
    candidateHash: digestText(candidate),
    sourceOfTruthHash: hashSourceOfTruth(source),
  };
  const signingInput = canonicalizeJson(base);
  const sig = cryptoSign(null, Buffer.from(signingInput, "utf8"), privateKeyFromJwk(key.privateKeyJwk));
  return { ...base, signature: { alg: "EdDSA", kid: key.kid, sig: sig.toString("base64url") } };
}

export function verifyReceipt(
  receipt: ProofReceipt,
  publicKeyJwk: JsonWebKey,
): { ok: boolean; reason?: string } {
  try {
    if (!receipt || typeof receipt !== "object") return { ok: false, reason: "malformed" };
    const { signature, ...base } = receipt;
    if (!signature || signature.alg !== "EdDSA" || typeof signature.sig !== "string") {
      return { ok: false, reason: "unsupported_signature" };
    }
    const signingInput = canonicalizeJson(base);
    const ok = cryptoVerify(
      null,
      Buffer.from(signingInput, "utf8"),
      publicKeyFromJwk(publicKeyJwk),
      Buffer.from(signature.sig, "base64url"),
    );
    return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "error" }; // fail-closed
  }
}
