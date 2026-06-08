export interface RequiredFact {
  label: string;
  value: string;
  slot?: { prefix?: string; suffix?: string };
}

export interface AllowedFact {
  label: string;
  value: string;
}

export interface ForbiddenPattern {
  label: string;
  pattern: string;
  flags?: string;
}

export interface RegisteredPattern {
  label: string;
  pattern: string;
}

export interface ExtractConfig {
  money?: boolean;
  dates?: boolean;
  percentages?: boolean;
  patterns?: RegisteredPattern[];
}

export interface SourceOfTruth {
  requiredFacts: RequiredFact[];
  allowedFacts: AllowedFact[];
  forbiddenPatterns?: ForbiddenPattern[];
  extract?: ExtractConfig;
}

export type ViolationCode =
  | "missing_required"
  | "fabricated_fact"
  | "forbidden_match"
  | "engine_error";

export interface Violation {
  code: ViolationCode;
  label: string;
  detail?: string;
}

export interface VerifyResult {
  verdict: "pass" | "block";
  violations: Violation[];
}

export interface ReceiptViolation {
  code: ViolationCode;
  label: string;
}

export type ReceiptContentHashRole = "candidate" | "source";

export interface ReceiptContentHash {
  role: ReceiptContentHashRole;
  alg: "sha256";
  value: string;
  canonicalization: string;
}

export type GroundedClaimKind = "money" | "date" | "percentage" | "pattern";

export interface GroundedClaim {
  kind: GroundedClaimKind;
  token: string;
  normalized: string;
  sourceLabel: string;
  sourceValue: string;
  sourceValueHash: string;
}

export interface UngroundedClaim {
  kind: GroundedClaimKind;
  token: string;
  normalized: string;
  label: string;
}

export interface GroundingTrace {
  groundedClaims: GroundedClaim[];
  ungrounded: UngroundedClaim[];
}

export interface ProofReceipt {
  version: "groundlock-receipt/v1";
  issuedAt: string;
  engineVersion: string;
  verdict: "pass" | "block";
  violations: ReceiptViolation[];
  candidateHash: string;
  sourceOfTruthHash: string;
  sourceHash: string;
  contentHashes: ReceiptContentHash[];
  signerKeyId: string;
  signerDomain: string;
  contentClass: string;
  groundedClaims: GroundedClaim[];
  canonicalOriginalUrl?: string;
  revocationPointer?: string;
  signature: { alg: "EdDSA"; kid: string; sig: string };
}

export interface SigningKey {
  kid: string;
  privateKeyJwk: JsonWebKey;
}

export interface IssueReceiptOptions {
  signerDomain?: string;
  contentClass?: string;
  canonicalOriginalUrl?: string;
  revocationPointer?: string;
}
