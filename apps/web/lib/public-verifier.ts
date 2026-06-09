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
import { MAX_FETCH_TIMEOUT_MS, configuredFetchTimeoutMs } from "./fetch-timeout";
import { configuredLaunchDomain, configuredLaunchHttpsUrl } from "./launch-url";
export { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./rate-limit";

export const MAX_VERIFY_BYTES = 256 * 1024;
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

const DEMO_SIGNER_DOMAIN = "publisher.example";
const revokedText = "Dear Jane Roe, your account AC-40192 shows a balance of $1,500.00. Revoked demo copy.";
let cachedDemoFixture: DemoFixture | null = null;

export function demoInputs() {
  const fixture = demoFixture();
  return {
    passText: fixture.passText,
    blockText: fixture.blockText,
    revokedText: fixture.revokedText,
    passHash: digestText(fixture.passText),
    blockHash: digestText(fixture.blockText),
    revokedHash: digestText(fixture.revokedText),
  };
}

export async function verifyPublicContentHash(contentHash: string): Promise<TrueNameVerifyResult> {
  const liveConfig = liveVerifierConfigFromEnv();
  if (liveConfig) {
    const signerDomain = configuredLaunchDomain(liveConfig.signerDomain);
    if (!signerDomain) {
      return {
        state: "UNVERIFIABLE",
        code: "signer_domain_invalid",
        explanation: "GROUNDLOCK_SIGNER_DOMAIN must be a valid public DNS name when configured",
      };
    }
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
    const dohEndpoint = configuredHttpsUrl(liveConfig.dohEndpoint);
    if (!dohEndpoint) {
      return {
        state: "UNVERIFIABLE",
        code: "doh_resolver_invalid",
        explanation: "GROUNDLOCK_DOH_ENDPOINT must be a valid HTTPS URL when GROUNDLOCK_SIGNER_DOMAIN is configured",
      };
    }
    const statusBaseUrl = configuredHttpsUrl(liveConfig.statusBaseUrl);
    if (!statusBaseUrl) {
      return {
        state: "UNVERIFIABLE",
        code: "status_resolver_invalid",
        explanation: "GROUNDLOCK_STATUS_BASE_URL must be a valid HTTPS URL when GROUNDLOCK_SIGNER_DOMAIN is configured",
      };
    }
    const fetchTimeoutMs = configuredFetchTimeoutMs();
    if (fetchTimeoutMs === null) {
      return {
        state: "UNVERIFIABLE",
        code: "fetch_timeout_invalid",
        explanation: `GROUNDLOCK_FETCH_TIMEOUT_MS must be an integer from 1 to ${MAX_FETCH_TIMEOUT_MS}`,
      };
    }
    const fetcher = fetchJsonWithTimeout(fetchTimeoutMs);
    return verifyTrueName(contentHash, signerDomain, {
      ...createDohTxtResolver(fetcher, dohEndpoint),
      statusResolver: createHttpStatusResolver(fetcher, statusBaseUrl),
    });
  }
  const fixture = demoFixture();
  return verifyTrueName(contentHash, fixture.domain, fixture.resolver);
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

function demoFixture(): DemoFixture {
  cachedDemoFixture ??= createDemoFixture();
  return cachedDemoFixture;
}

function createDemoFixture(): DemoFixture {
  const demoKey = generateSigningKey("demo-key-1");
  const passReceipt = makeReceipt(cleanCandidate, demoKey);
  const blockReceipt = makeReceipt(fabricatingCandidate, demoKey);
  const revokedReceipt = makeReceipt(revokedText, demoKey);
  const receipts = [passReceipt, blockReceipt, revokedReceipt];
  const txt: Record<string, string[]> = {};
  const claimStatus = new Map<string, ReturnType<typeof createClaimStatusRecord>>();
  const keyStatus = createKeyStatusRecord({
    signerDomain: DEMO_SIGNER_DOMAIN,
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
    domain: DEMO_SIGNER_DOMAIN,
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

function makeReceipt(text: string, key: ReturnType<typeof generateSigningKey>): ProofReceipt {
  return issueVerifiedReceipt(
    text,
    exampleSource as SourceOfTruth,
    { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
    new Date().toISOString(),
    {
      signerDomain: DEMO_SIGNER_DOMAIN,
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

function fetchJsonWithTimeout(timeoutMs: number): FetchJson {
  return async (url, init) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  };
}

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

function configuredHttpsUrl(value: string | null): string | null {
  return configuredLaunchHttpsUrl(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
