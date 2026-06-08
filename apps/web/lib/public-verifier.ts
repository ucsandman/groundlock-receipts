import {
  createClaimStatusRecord,
  createDohTxtResolver,
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
  type StatusLookup,
  type StatusLookupResult,
  type StatusRecord,
  type StatusResolver,
  type TrueNameResolver,
  type TrueNameVerifyResult,
} from "@groundlock/core";
import { cleanCandidate, exampleSource, fabricatingCandidate } from "./examples";

export const MAX_VERIFY_BYTES = 256 * 1024;
export const RATE_LIMIT_MAX = readPositiveIntEnv("GROUNDLOCK_RATE_LIMIT_MAX", 240);
export const RATE_LIMIT_WINDOW_MS = readPositiveIntEnv("GROUNDLOCK_RATE_LIMIT_WINDOW_MS", 60_000);
export const WHAT_IT_PROVES =
  "The verifier reconstructs a signed GroundLock receipt from DNS resolver-cache TXT chunks, then verifies the content hash, receipt hash, signature, grounding verdict, and revocation status.";
export const WHAT_IT_DOES_NOT_PROVE =
  "It does not prove the prose is true, that unmatched prose is complete, that issuance time is independently timestamped, or that resolver caches will retain every chunk.";

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
  const liveConfig = liveVerifierConfigFromEnv();
  if (liveConfig) {
    if (!liveConfig.statusBaseUrl) {
      return {
        state: "UNVERIFIABLE",
        code: "status_resolver_not_configured",
        explanation: "GROUNDLOCK_STATUS_BASE_URL is required when GROUNDLOCK_SIGNER_DOMAIN is configured",
      };
    }
    if (!liveConfig.dohEndpoint) {
      return {
        state: "UNVERIFIABLE",
        code: "doh_resolver_not_configured",
        explanation: "GROUNDLOCK_DOH_ENDPOINT is required when GROUNDLOCK_SIGNER_DOMAIN is configured",
      };
    }
    const fetcher = fetchJson;
    return verifyTrueName(contentHash, liveConfig.signerDomain, {
      ...createDohTxtResolver(fetcher, liveConfig.dohEndpoint),
      statusResolver: createHttpStatusResolver(fetcher, liveConfig.statusBaseUrl),
    });
  }
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

interface LiveVerifierConfig {
  signerDomain: string;
  dohEndpoint: string | null;
  statusBaseUrl: string | null;
}

type FetchJson = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

function liveVerifierConfigFromEnv(): LiveVerifierConfig | null {
  const signerDomain = cleanEnv(process.env.GROUNDLOCK_SIGNER_DOMAIN);
  if (!signerDomain) return null;
  return {
    signerDomain,
    dohEndpoint: cleanEnv(process.env.GROUNDLOCK_DOH_ENDPOINT),
    statusBaseUrl: cleanEnv(process.env.GROUNDLOCK_STATUS_BASE_URL),
  };
}

const fetchJson: FetchJson = async (url, init) => fetch(url, init);

function createHttpStatusResolver(fetcher: FetchJson, baseUrl: string): StatusResolver {
  return {
    resolveKeyStatus: async (lookup) => fetchStatusRecord(fetcher, baseUrl, "key", lookup),
    resolveClaimStatus: async (lookup) => fetchStatusRecord(fetcher, baseUrl, "claim", lookup),
  };
}

async function fetchStatusRecord(
  fetcher: FetchJson,
  baseUrl: string,
  kind: "key" | "claim",
  lookup: StatusLookup,
): Promise<StatusLookupResult> {
  if (lookup.publicResolverAllowed !== true) {
    return { type: "unreachable", reason: "private_status_lookup_not_supported" };
  }
  const url = new URL(`${baseUrl.replace(/\/+$/, "")}/${kind}`);
  url.searchParams.set("lookup", lookup.lookupKey);
  let body: unknown;
  try {
    const response = await fetcher(url.toString(), { headers: { Accept: "application/json" } });
    if (response.status === 404) return { type: "missing", reason: "status_not_found" };
    if (!response.ok) return { type: "unreachable", reason: "status_endpoint_unreachable" };
    body = await response.json();
  } catch {
    return { type: "unreachable", reason: "status_endpoint_unreachable" };
  }
  if (!isRecord(body)) return { type: "malformed", reason: "status_json_malformed" };
  return { type: "found", record: body as unknown as StatusRecord };
}

function cleanEnv(value: string | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
