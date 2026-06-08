import {
  createClaimStatusRecord,
  createDnsCacheRecords,
  createKeyStatusRecord,
  digestText,
  generateSigningKey,
  issueVerifiedReceipt,
  receiptStatusHash,
  verifyTrueName,
  type DnsCacheRecords,
  type ProofReceipt,
  type SourceOfTruth,
  type StatusLookupResult,
  type StatusResolver,
  type TrueNameResolver,
  type TrueNameVerifyResult,
} from "@groundlock/core";
import { cleanCandidate, exampleSource, fabricatingCandidate } from "./examples";

export const MAX_VERIFY_BYTES = 256 * 1024;
export const RATE_LIMIT_MAX = 20;
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const WHAT_IT_PROVES =
  "This demo reconstructs a signed GroundLock receipt from simulated DNS resolver-cache TXT chunks, then verifies the content hash, receipt hash, signature, grounding verdict, and revocation status.";
export const WHAT_IT_DOES_NOT_PROVE =
  "It does not prove the prose is true, that unmatched prose is complete, that issuance time is independently timestamped, or that live production DNS cache warming is configured.";

interface DemoFixture {
  domain: string;
  passText: string;
  blockText: string;
  revokedText: string;
  resolver: TrueNameResolver;
}

const signerDomain = "publisher.example";
const demoKey = generateSigningKey("demo-key-1");
const revokedText = "Dear Jane Roe, your account AC-40192 shows a balance of $1,500.00. Revoked demo copy.";
const demoFixture = createDemoFixture();

export function demoInputs() {
  return {
    passText: demoFixture.passText,
    blockText: demoFixture.blockText,
    revokedText: demoFixture.revokedText,
    passHash: digestText(demoFixture.passText),
    blockHash: digestText(demoFixture.blockText),
    revokedHash: digestText(demoFixture.revokedText),
  };
}

export async function verifyPublicContentHash(contentHash: string): Promise<TrueNameVerifyResult> {
  return verifyTrueName(contentHash, demoFixture.domain, demoFixture.resolver);
}

export function summarizeReceipt(receipt: ProofReceipt | undefined) {
  if (!receipt) return null;
  return {
    signerDomain: receipt.signerDomain,
    signerKeyId: receipt.signerKeyId,
    contentClass: receipt.contentClass,
    issuedAt: receipt.issuedAt,
    verdict: receipt.verdict,
    contentHash: receipt.candidateHash,
    receiptHash: receiptStatusHash(receipt),
  };
}

function createDemoFixture(): DemoFixture {
  const passReceipt = makeReceipt(cleanCandidate);
  const blockReceipt = makeReceipt(fabricatingCandidate);
  const revokedReceipt = makeReceipt(revokedText);
  const receipts = [passReceipt, blockReceipt, revokedReceipt];
  const txt: Record<string, string[]> = {};
  const claimStatus = new Map<string, ReturnType<typeof createClaimStatusRecord>>();
  const keyStatus = createKeyStatusRecord({
    signerDomain,
    kid: demoKey.kid,
    status: "active",
    issuedAt: passReceipt.issuedAt,
  });

  for (const receipt of receipts) {
    const receiptHash = receiptStatusHash(receipt);
    mergeTxt(txt, createDnsCacheRecords(receipt, demoKey.publicKeyJwk, { chunkSize: 180 }));
    claimStatus.set(
      receiptHash,
      createClaimStatusRecord({
        receiptHash,
        status: receipt === revokedReceipt ? "revoked" : "active",
        issuedAt: receipt.issuedAt,
        ...(receipt === revokedReceipt ? { reason: "demo revocation" } : {}),
      }),
    );
  }

  const statusResolver: StatusResolver = {
    resolveKeyStatus: async (): Promise<StatusLookupResult> => ({ type: "found", record: keyStatus }),
    resolveClaimStatus: async (lookup): Promise<StatusLookupResult> => {
      const hash = lookup.lookupKey.startsWith("claim:") ? lookup.lookupKey.slice("claim:".length) : "";
      const record = claimStatus.get(hash);
      return record ? { type: "found", record } : { type: "missing" };
    },
  };

  return {
    domain: signerDomain,
    passText: cleanCandidate,
    blockText: fabricatingCandidate,
    revokedText,
    resolver: {
      statusResolver,
      resolveTxt: async (name) => {
        const records = txt[name];
        return records
          ? { type: "found", records, dnssecValidated: true }
          : { type: "missing", code: "dns_txt_missing", explanation: `No TXT record found for ${name}` };
      },
    },
  };
}

function makeReceipt(text: string): ProofReceipt {
  return issueVerifiedReceipt(
    text,
    exampleSource as SourceOfTruth,
    { kid: demoKey.kid, privateKeyJwk: demoKey.privateKeyJwk },
    new Date().toISOString(),
    {
      signerDomain,
      contentClass: "demo-message",
    },
  );
}

function mergeTxt(txt: Record<string, string[]>, records: DnsCacheRecords): void {
  for (const record of [records.identity, records.manifest, ...records.chunks]) {
    txt[record.name] = [record.value];
  }
}
