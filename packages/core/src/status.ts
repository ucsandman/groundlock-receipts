import { createHmac } from "node:crypto";
import { digestJson } from "./canonicalize.js";
import { verifyReceipt } from "./receipt.js";
import type { ProofReceipt } from "./types.js";

export type StatusRecordKind = "key" | "claim";
export type StatusRecordStatus = "active" | "revoked" | "retracted" | "compromised";
export type VerificationState = "PASS" | "BLOCK" | "REVOKED" | "UNVERIFIABLE";

export interface KeyStatusRecord {
  version: "groundlock-status/v1";
  kind: "key";
  subject: { signerDomain: string; kid: string };
  status: StatusRecordStatus;
  issuedAt: string;
  reason?: string;
}

export interface ClaimStatusRecord {
  version: "groundlock-status/v1";
  kind: "claim";
  subject: { receiptHash: string };
  status: StatusRecordStatus;
  issuedAt: string;
  reason?: string;
}

export type StatusRecord = KeyStatusRecord | ClaimStatusRecord;

export interface PublicStatusLookup {
  mode: "public";
  kind: StatusRecordKind;
  lookupKey: string;
  publicResolverAllowed: true;
}

export interface PrivateStatusLookup {
  mode: "private";
  kind: StatusRecordKind;
  lookupKey: string;
  publicResolverAllowed: boolean;
}

export type StatusLookup = PublicStatusLookup | PrivateStatusLookup;

export type StatusLookupResult =
  | { type: "found"; record: StatusRecord }
  | { type: "missing"; reason?: string }
  | { type: "unreachable"; reason?: string }
  | { type: "malformed"; reason?: string };

export interface StatusResolver {
  resolveKeyStatus(lookup: StatusLookup): Promise<StatusLookupResult>;
  resolveClaimStatus(lookup: StatusLookup): Promise<StatusLookupResult>;
}

export interface StatusVerificationResult {
  state: VerificationState;
  reason: string;
}

export interface PrivateLookupOptions {
  secret: string;
  salt: string;
  allowPublicResolver?: boolean;
}

export function createKeyStatusRecord(opts: {
  signerDomain: string;
  kid: string;
  status: StatusRecordStatus;
  issuedAt: string;
  reason?: string;
}): KeyStatusRecord {
  return {
    version: "groundlock-status/v1",
    kind: "key",
    subject: { signerDomain: opts.signerDomain, kid: opts.kid },
    status: opts.status,
    issuedAt: opts.issuedAt,
    ...(opts.reason ? { reason: opts.reason } : {}),
  };
}

export function createClaimStatusRecord(opts: {
  receiptHash: string;
  status: StatusRecordStatus;
  issuedAt: string;
  reason?: string;
}): ClaimStatusRecord {
  return {
    version: "groundlock-status/v1",
    kind: "claim",
    subject: { receiptHash: opts.receiptHash },
    status: opts.status,
    issuedAt: opts.issuedAt,
    ...(opts.reason ? { reason: opts.reason } : {}),
  };
}

export function statusRecordHash(record: StatusRecord): string {
  return digestJson(record);
}

export function receiptStatusHash(receipt: ProofReceipt): string {
  const { signature: _signature, ...body } = receipt;
  return digestJson(body);
}

export function publicKeyStatusLookup(signerDomain: string, kid: string): PublicStatusLookup {
  return {
    mode: "public",
    kind: "key",
    lookupKey: `key:${signerDomain}:${kid}`,
    publicResolverAllowed: true,
  };
}

export function publicClaimStatusLookup(receiptHash: string): PublicStatusLookup {
  return {
    mode: "public",
    kind: "claim",
    lookupKey: `claim:${receiptHash}`,
    publicResolverAllowed: true,
  };
}

export function privateKeyStatusLookup(
  signerDomain: string,
  kid: string,
  opts: PrivateLookupOptions,
): PrivateStatusLookup {
  return privateLookup("key", `${signerDomain}:${kid}`, opts);
}

export function privateClaimStatusLookup(receiptHash: string, opts: PrivateLookupOptions): PrivateStatusLookup {
  return privateLookup("claim", receiptHash, opts);
}

export async function verifyReceiptWithStatus(
  receipt: ProofReceipt,
  publicKeyJwk: JsonWebKey,
  resolver: StatusResolver,
): Promise<StatusVerificationResult> {
  const signatureResult = verifyReceipt(receipt, publicKeyJwk);
  if (!signatureResult.ok) {
    return {
      state: "UNVERIFIABLE",
      reason: `receipt_signature_${signatureResult.reason ?? "failed"}`,
    };
  }

  const receiptHash = receiptStatusHash(receipt);
  let keyStatusResult: StatusLookupResult;
  try {
    keyStatusResult = await resolver.resolveKeyStatus(publicKeyStatusLookup(receipt.signerDomain, receipt.signerKeyId));
  } catch {
    return { state: "UNVERIFIABLE", reason: "key_status_unreachable" };
  }
  const keyEval = evaluateStatus(
    keyStatusResult,
    "key",
    receipt,
    receiptHash,
  );
  if (keyEval.state !== "ACTIVE") return toVerificationState(keyEval);

  let claimStatusResult: StatusLookupResult;
  try {
    claimStatusResult = await resolver.resolveClaimStatus(publicClaimStatusLookup(receiptHash));
  } catch {
    return { state: "UNVERIFIABLE", reason: "claim_status_unreachable" };
  }
  const claimEval = evaluateStatus(
    claimStatusResult,
    "claim",
    receipt,
    receiptHash,
  );
  if (claimEval.state !== "ACTIVE") return toVerificationState(claimEval);

  if (receipt.verdict === "block") {
    return { state: "BLOCK", reason: "receipt verdict is block" };
  }
  return { state: "PASS", reason: "signature, key status, and claim status verified" };
}

type StatusEval =
  | { state: "ACTIVE"; reason: string }
  | { state: "REVOKED"; reason: string }
  | { state: "UNVERIFIABLE"; reason: string };

function evaluateStatus(
  result: StatusLookupResult,
  expectedKind: StatusRecordKind,
  receipt: ProofReceipt,
  receiptHash: string,
): StatusEval {
  if (result.type !== "found") {
    return { state: "UNVERIFIABLE", reason: `${expectedKind}_status_${result.type}` };
  }
  const record = result.record;
  if (!isStatusRecordForKind(record, expectedKind) || !matchesStatusSubject(record, expectedKind, receipt, receiptHash)) {
    return { state: "UNVERIFIABLE", reason: `${expectedKind}_status_malformed` };
  }
  if (record.status === "active") {
    return { state: "ACTIVE", reason: `${expectedKind}_status_active` };
  }
  return {
    state: "REVOKED",
    reason: `${expectedKind}_status_${record.status}${record.reason ? ": " + record.reason : ""}`,
  };
}

function toVerificationState(evalResult: Exclude<StatusEval, { state: "ACTIVE" }>): StatusVerificationResult {
  return { state: evalResult.state, reason: evalResult.reason };
}

function matchesStatusSubject(
  record: StatusRecord,
  expectedKind: StatusRecordKind,
  receipt: ProofReceipt,
  receiptHash: string,
): boolean {
  if (record.kind === "key") {
    return record.subject.signerDomain === receipt.signerDomain && record.subject.kid === receipt.signerKeyId;
  }
  return record.subject.receiptHash === receiptHash;
}

function isStatusRecordForKind(record: unknown, expectedKind: StatusRecordKind): record is StatusRecord {
  if (!isRecord(record)) return false;
  if (record.version !== "groundlock-status/v1" || record.kind !== expectedKind || !isString(record.issuedAt)) return false;
  if (!isStatusValue(record.status)) return false;
  if (record.reason !== undefined && !isString(record.reason)) return false;
  if (expectedKind === "key") {
    return (
      record.kind === "key" &&
      isRecord(record.subject) &&
      isString(record.subject.signerDomain) &&
      isString(record.subject.kid)
    );
  }
  return record.kind === "claim" && isRecord(record.subject) && isString(record.subject.receiptHash);
}

function isStatusValue(value: unknown): value is StatusRecordStatus {
  return value === "active" || value === "revoked" || value === "retracted" || value === "compromised";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function privateLookup(kind: StatusRecordKind, input: string, opts: PrivateLookupOptions): PrivateStatusLookup {
  const digest = createHmac("sha256", opts.secret)
    .update(opts.salt, "utf8")
    .update("\0", "utf8")
    .update(input, "utf8")
    .digest("base64url");
  return {
    mode: "private",
    kind,
    lookupKey: `hmac-sha256:${digest}`,
    publicResolverAllowed: opts.allowPublicResolver === true,
  };
}
