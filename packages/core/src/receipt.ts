import { sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { canonicalizeJson, digestText } from "./canonicalize.js";
import { hashSourceOfTruth } from "./ruleset.js";
import { privateKeyFromJwk, publicKeyFromJwk } from "./keys.js";
import { traceGrounding, verify } from "./verify.js";
import type { IssueReceiptOptions, ProofReceipt, SigningKey, SourceOfTruth, VerifyResult } from "./types.js";

export const ENGINE_VERSION = "0.1.0";
const DEFAULT_SIGNER_DOMAIN = "local.groundlock.invalid";
const DEFAULT_CONTENT_CLASS = "business-message";
export const TEXT_CANONICALIZATION = "groundlock:text:nfc-v1";
export const SOURCE_CANONICALIZATION = "groundlock:source-of-truth:v1";

export function issueReceipt(
  result: VerifyResult,
  candidate: string,
  source: SourceOfTruth,
  key: SigningKey,
  issuedAt: string,
  options: IssueReceiptOptions = {},
): ProofReceipt {
  const candidateHash = digestText(candidate);
  const sourceHash = hashSourceOfTruth(source);
  const signerDomain = options.signerDomain ?? DEFAULT_SIGNER_DOMAIN;
  const contentClass = options.contentClass ?? DEFAULT_CONTENT_CLASS;
  const base = {
    version: "groundlock-receipt/v1" as const,
    issuedAt,
    engineVersion: ENGINE_VERSION,
    verdict: result.verdict,
    violations: result.violations.map((v) => ({ code: v.code, label: v.label })),
    candidateHash,
    sourceOfTruthHash: sourceHash,
    sourceHash,
    contentHashes: [
      { role: "candidate" as const, alg: "sha256" as const, value: candidateHash, canonicalization: TEXT_CANONICALIZATION },
      { role: "source" as const, alg: "sha256" as const, value: sourceHash, canonicalization: SOURCE_CANONICALIZATION },
    ],
    signerKeyId: key.kid,
    signerDomain,
    contentClass,
    groundedClaims: traceGrounding(candidate, source).groundedClaims,
    ...(options.canonicalOriginalUrl
      ? { canonicalOriginalUrl: new URL(options.canonicalOriginalUrl).toString() }
      : {}),
    ...(options.revocationPointer ? { revocationPointer: options.revocationPointer } : {}),
  };
  const signingInput = canonicalizeJson(base);
  const sig = cryptoSign(null, Buffer.from(signingInput, "utf8"), privateKeyFromJwk(key.privateKeyJwk));
  return { ...base, signature: { alg: "EdDSA", kid: key.kid, sig: sig.toString("base64url") } };
}

export function issueVerifiedReceipt(
  candidate: string,
  source: SourceOfTruth,
  key: SigningKey,
  issuedAt: string,
  options: IssueReceiptOptions = {},
): ProofReceipt {
  return issueReceipt(verify(candidate, source), candidate, source, key, issuedAt, options);
}

export function verifyReceipt(
  receipt: ProofReceipt,
  publicKeyJwk: JsonWebKey,
): { ok: boolean; reason?: string } {
  try {
    if (!receipt || typeof receipt !== "object") return { ok: false, reason: "malformed" };
    const shapeReason = validateReceiptShape(receipt);
    if (shapeReason) return { ok: false, reason: shapeReason };
    const { signature, ...base } = receipt;
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

function validateReceiptShape(receipt: ProofReceipt): string | undefined {
  const r = receipt as Partial<ProofReceipt>;
  if (r.version !== "groundlock-receipt/v1") {
    return r.version ? "unsupported_version" : "missing_required_field";
  }
  if (
    !isString(r.issuedAt) ||
    !isString(r.engineVersion) ||
    (r.verdict !== "pass" && r.verdict !== "block") ||
    !Array.isArray(r.violations) ||
    !isHash(r.candidateHash) ||
    !isHash(r.sourceOfTruthHash) ||
    !isHash(r.sourceHash) ||
    r.sourceHash !== r.sourceOfTruthHash ||
    !Array.isArray(r.contentHashes) ||
    !isString(r.signerKeyId) ||
    !isString(r.signerDomain) ||
    !isString(r.contentClass) ||
    !Array.isArray(r.groundedClaims)
  ) {
    return "missing_required_field";
  }
  if (!r.signature || r.signature.alg !== "EdDSA" || !isString(r.signature.sig) || !isString(r.signature.kid)) {
    return "unsupported_signature";
  }
  if (r.verdict === "pass" && r.violations.length > 0) {
    return "verdict_violation_mismatch";
  }
  if (r.signature.kid !== r.signerKeyId) {
    return "missing_required_field";
  }
  if (!hasContentHash(r, "candidate", r.candidateHash) || !hasContentHash(r, "source", r.sourceHash)) {
    return "missing_required_field";
  }
  if (!r.violations.every((v) => v && isString(v.code) && isString(v.label))) {
    return "missing_required_field";
  }
  if (!r.groundedClaims.every(isGroundedClaimShape)) {
    return "missing_required_field";
  }
  if (r.canonicalOriginalUrl !== undefined && !isString(r.canonicalOriginalUrl)) {
    return "missing_required_field";
  }
  if (r.revocationPointer !== undefined && !isString(r.revocationPointer)) {
    return "missing_required_field";
  }
  return undefined;
}

function hasContentHash(receipt: Partial<ProofReceipt>, role: "candidate" | "source", value: string): boolean {
  return (
    receipt.contentHashes?.some(
      (entry) =>
        entry &&
        entry.role === role &&
        entry.alg === "sha256" &&
        entry.value === value &&
        isString(entry.canonicalization),
    ) ?? false
  );
}

function isGroundedClaimShape(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const claim = value as Record<string, unknown>;
  return (
    (claim.kind === "money" || claim.kind === "date" || claim.kind === "percentage" || claim.kind === "pattern") &&
    isString(claim.token) &&
    isString(claim.normalized) &&
    isString(claim.sourceLabel) &&
    isString(claim.sourceValue) &&
    isHash(claim.sourceValueHash)
  );
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("sha256:") && value.length > "sha256:".length;
}
