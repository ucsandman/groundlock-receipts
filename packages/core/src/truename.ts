import { canonicalizeJson, sha256 } from "./canonicalize.js";
import { receiptStatusHash, verifyReceiptWithStatus, type StatusResolver } from "./status.js";
import type { ProofReceipt } from "./types.js";

export type TrueNameState = "PASS" | "BLOCK" | "UNVERIFIABLE" | "REVOKED";

export interface CacheManifestRecord {
  version: "gdm1";
  receiptHash: string;
  payloadHash: string;
  chunkCount: number;
  signerDomain: string;
  kid: string;
}

export interface CacheChunkRecord {
  version: "gdc1";
  index: number;
  data: string;
}

export interface IdentityRecord {
  version: "glt1";
  kid: string;
  publicKeyJwk: JsonWebKey;
}

export type TxtLookupResult =
  | { type: "found"; records: string[]; dnssecValidated: boolean }
  | { type: "missing"; code: string; explanation: string }
  | { type: "unverifiable"; code: string; explanation: string };

export interface TrueNameResolver {
  resolveTxt(name: string): Promise<TxtLookupResult>;
  statusResolver: StatusResolver;
}

export interface TrueNameVerifyResult {
  state: TrueNameState;
  code: string;
  explanation: string;
  receipt?: ProofReceipt;
}

export interface LocalTrueNameFixture {
  txt: Record<string, string[]>;
  statusResolver: StatusResolver;
}

export interface DnsCacheRecords {
  identity: { name: string; type: "TXT"; value: string };
  manifest: { name: string; type: "TXT"; value: string };
  chunks: Array<{ index: number; name: string; type: "TXT"; value: string }>;
}

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

type ParseResult<T> = { type: "ok"; value: T } | { type: "error"; code: string; explanation: string };

export function contentHashToDnsName(contentHash: string, signerDomain: string): string {
  return `gl-${dnsSafeHashLabel(contentHash)}._groundlock.${normalizeDomain(signerDomain)}`;
}

export function truenameIdentityName(signerDomain: string): string {
  return `_truename.${normalizeDomain(signerDomain)}`;
}

export function cacheChunkName(contentHash: string, signerDomain: string, index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error("chunk_index_invalid");
  return `c${index}.${contentHashToDnsName(contentHash, signerDomain)}`;
}

export function createDnsCacheRecords(
  receipt: ProofReceipt,
  publicKeyJwk: JsonWebKey,
  opts: { chunkSize?: number } = {},
): DnsCacheRecords {
  const chunkSize = opts.chunkSize ?? 180;
  if (!Number.isInteger(chunkSize) || chunkSize < 32 || chunkSize > 200) {
    throw new Error("chunk_size_invalid");
  }
  const payload = Buffer.from(canonicalizeJson(receipt), "utf8").toString("base64url");
  const chunks = chunkString(payload, chunkSize);
  return {
    identity: {
      name: truenameIdentityName(receipt.signerDomain),
      type: "TXT",
      value: formatIdentityRecord({ kid: receipt.signerKeyId, publicKeyJwk }),
    },
    manifest: {
      name: contentHashToDnsName(receipt.candidateHash, receipt.signerDomain),
      type: "TXT",
      value: formatCacheManifestRecord({
        receiptHash: receiptStatusHash(receipt),
        payloadHash: sha256(payload),
        chunkCount: chunks.length,
        signerDomain: receipt.signerDomain,
        kid: receipt.signerKeyId,
      }),
    },
    chunks: chunks.map((data, index) => ({
      index,
      name: cacheChunkName(receipt.candidateHash, receipt.signerDomain, index),
      type: "TXT",
      value: formatCacheChunkRecord({ index, data }),
    })),
  };
}

export function formatCacheManifestRecord(record: Omit<CacheManifestRecord, "version">): string {
  const out = `gdm1 rh=${stripSha256(record.receiptHash)} ph=${stripSha256(record.payloadHash)} n=${record.chunkCount} key=${normalizeDomain(record.signerDomain)}#${record.kid}`;
  if (out.length > 255) throw new Error("cache_manifest_record_too_long");
  return out;
}

export function parseCacheManifestRecord(record: string): CacheManifestRecord {
  const parts = parseKvRecord(record, "gdm1");
  const receiptHash = parts.get("rh");
  const payloadHash = parts.get("ph");
  const chunkCountRaw = parts.get("n");
  const key = parts.get("key");
  if (!receiptHash || !payloadHash || !chunkCountRaw || !key) throw new Error("cache_manifest_record_malformed");
  const chunkCount = Number(chunkCountRaw);
  const [signerDomain, kid] = key.split("#");
  if (!Number.isInteger(chunkCount) || chunkCount <= 0 || !signerDomain || !kid) {
    throw new Error("cache_manifest_record_malformed");
  }
  return {
    version: "gdm1",
    receiptHash: ensureSha256(receiptHash),
    payloadHash: ensureSha256(payloadHash),
    chunkCount,
    signerDomain: normalizeDomain(signerDomain),
    kid,
  };
}

export function formatCacheChunkRecord(record: Omit<CacheChunkRecord, "version">): string {
  const out = `gdc1 i=${record.index} d=${record.data}`;
  if (out.length > 255) throw new Error("cache_chunk_record_too_long");
  return out;
}

export function parseCacheChunkRecord(record: string): CacheChunkRecord {
  const parts = parseKvRecord(record, "gdc1");
  const indexRaw = parts.get("i");
  const data = parts.get("d");
  if (!indexRaw || !data) throw new Error("cache_chunk_record_malformed");
  const index = Number(indexRaw);
  if (!Number.isInteger(index) || index < 0 || !/^[A-Za-z0-9_-]+$/.test(data)) {
    throw new Error("cache_chunk_record_malformed");
  }
  return { version: "gdc1", index, data };
}

export function formatIdentityRecord(record: Omit<IdentityRecord, "version">): string {
  const jwk = base64urlEncode(canonicalizeJson(record.publicKeyJwk));
  const out = `glt1 kid=${record.kid} alg=EdDSA jwk=${jwk}`;
  if (out.length > 255) throw new Error("identity_record_too_long");
  return out;
}

export function parseIdentityRecord(record: string): IdentityRecord {
  const parts = parseKvRecord(record, "glt1");
  const kid = parts.get("kid");
  const alg = parts.get("alg");
  const jwk = parts.get("jwk");
  if (!kid || alg !== "EdDSA" || !jwk) throw new Error("identity_record_malformed");
  return {
    version: "glt1",
    kid,
    publicKeyJwk: JSON.parse(base64urlDecode(jwk)) as JsonWebKey,
  };
}

export function createLocalTrueNameResolver(fixture: LocalTrueNameFixture): TrueNameResolver {
  return {
    statusResolver: fixture.statusResolver,
    async resolveTxt(name: string): Promise<TxtLookupResult> {
      const records = fixture.txt[normalizeName(name)];
      if (!records) {
        return { type: "missing", code: "dns_txt_missing", explanation: `No TXT record found for ${name}` };
      }
      return { type: "found", records, dnssecValidated: true };
    },
  };
}

export function createDohTxtResolver(
  fetcher: FetchLike,
  endpoint = "https://cloudflare-dns.com/dns-query",
): Pick<TrueNameResolver, "resolveTxt"> {
  return {
    async resolveTxt(name: string): Promise<TxtLookupResult> {
      const url = `${endpoint}?name=${encodeURIComponent(name)}&type=TXT`;
      let body: unknown;
      try {
        const response = await fetcher(url, { headers: { Accept: "application/dns-json" } });
        if (!response.ok) {
          return { type: "unverifiable", code: "doh_unreachable", explanation: "DoH endpoint was unreachable" };
        }
        body = await response.json();
      } catch {
        return { type: "unverifiable", code: "doh_unreachable", explanation: "DoH endpoint was unreachable" };
      }
      const parsed = parseDohBody(body);
      if (!parsed) {
        return { type: "unverifiable", code: "doh_malformed", explanation: "DoH response JSON was malformed" };
      }
      if (parsed.AD !== true) {
        return {
          type: "unverifiable",
          code: "dnssec_not_validated",
          explanation: "DoH response did not carry a validated DNSSEC AD signal",
        };
      }
      if (parsed.Status !== 0 || !Array.isArray(parsed.Answer)) {
        return { type: "missing", code: "dns_txt_missing", explanation: `No TXT record found for ${name}` };
      }
      const records: string[] = [];
      for (const answer of parsed.Answer) {
        if (answer.type !== 16) continue;
        if (typeof answer.data !== "string") {
          return { type: "unverifiable", code: "doh_malformed", explanation: "DoH TXT answer was malformed" };
        }
        records.push(decodeTxtData(answer.data));
      }
      return records.length
        ? { type: "found", records, dnssecValidated: true }
        : { type: "missing", code: "dns_txt_missing", explanation: `No TXT record found for ${name}` };
    },
  };
}

export async function verifyTrueName(
  contentHash: string,
  signerDomain: string,
  resolver: TrueNameResolver,
): Promise<TrueNameVerifyResult> {
  let manifestLookup: TxtLookupResult;
  try {
    manifestLookup = await resolver.resolveTxt(contentHashToDnsName(contentHash, signerDomain));
  } catch {
    return state("UNVERIFIABLE", "resolver_error", "TrueName resolver failed during DNS cache manifest lookup");
  }
  if (manifestLookup.type !== "found") return state("UNVERIFIABLE", manifestLookup.code, manifestLookup.explanation);
  if (manifestLookup.dnssecValidated !== true) {
    return state("UNVERIFIABLE", "dnssec_not_validated", "DNS TXT lookup was not DNSSEC validated");
  }
  const manifestResult = parseUniqueManifest(manifestLookup.records);
  if (manifestResult.type !== "ok") return state("UNVERIFIABLE", manifestResult.code, manifestResult.explanation);
  const manifest = manifestResult.value;

  let identityLookup: TxtLookupResult;
  try {
    identityLookup = await resolver.resolveTxt(truenameIdentityName(signerDomain));
  } catch {
    return state("UNVERIFIABLE", "resolver_error", "TrueName resolver failed during identity lookup");
  }
  if (identityLookup.type !== "found") return state("UNVERIFIABLE", identityLookup.code, identityLookup.explanation);
  if (identityLookup.dnssecValidated !== true) {
    return state("UNVERIFIABLE", "dnssec_not_validated", "DNS TXT lookup was not DNSSEC validated");
  }
  const identityResult = parseUniqueIdentity(identityLookup.records);
  if (identityResult.type !== "ok") return state("UNVERIFIABLE", identityResult.code, identityResult.explanation);
  const identity = identityResult.value;

  if (manifest.signerDomain !== normalizeDomain(signerDomain) || manifest.kid !== identity.kid) {
    return state("UNVERIFIABLE", "identity_key_mismatch", "DNS cache manifest key reference did not match identity record");
  }

  const receiptResult = await reconstructReceiptFromCache(contentHash, signerDomain, manifest, resolver);
  if (receiptResult.type !== "ok") return state("UNVERIFIABLE", receiptResult.code, receiptResult.explanation);
  const receipt = receiptResult.receipt;
  if (!isFetchedReceiptShape(receipt)) {
    return state("UNVERIFIABLE", "receipt_malformed", "Cached receipt was malformed");
  }

  if (normalizeDomain(receipt.signerDomain) !== manifest.signerDomain || receipt.signerKeyId !== manifest.kid) {
    return state("UNVERIFIABLE", "receipt_signer_mismatch", "Cached receipt signer did not match DNS cache manifest");
  }
  if (
    receipt.candidateHash !== contentHash ||
    !receipt.contentHashes.some((entry) => entry.role === "candidate" && entry.value === contentHash)
  ) {
    return state("UNVERIFIABLE", "content_hash_mismatch", "Cached receipt does not describe the requested content hash");
  }
  if (receiptStatusHash(receipt) !== manifest.receiptHash) {
    return state("UNVERIFIABLE", "receipt_hash_mismatch", "Cached receipt body hash did not match DNS cache manifest");
  }

  let status: Awaited<ReturnType<typeof verifyReceiptWithStatus>>;
  try {
    status = await verifyReceiptWithStatus(receipt, identity.publicKeyJwk, resolver.statusResolver);
  } catch {
    return { ...state("UNVERIFIABLE", "status_unverifiable", "Status verification failed"), receipt };
  }
  if (status.state === "PASS") {
    return { state: "PASS", code: "verified", explanation: "DNS cache receipt verified", receipt };
  }
  if (status.state === "BLOCK") {
    return { state: "BLOCK", code: "receipt_blocked", explanation: status.reason, receipt };
  }
  if (status.state === "REVOKED") {
    return { state: "REVOKED", code: "status_revoked", explanation: status.reason, receipt };
  }
  return {
    state: "UNVERIFIABLE",
    code: status.reason.startsWith("receipt_signature_") ? "signature_invalid" : "status_unverifiable",
    explanation: status.reason,
    receipt,
  };
}

function parseUniqueManifest(records: string[]): ParseResult<CacheManifestRecord> {
  const parsed = new Map<string, CacheManifestRecord>();
  let malformed = false;
  for (const record of records) {
    try {
      const manifest = parseCacheManifestRecord(record);
      parsed.set(`${manifest.receiptHash}\0${manifest.payloadHash}\0${manifest.chunkCount}\0${manifest.signerDomain}\0${manifest.kid}`, manifest);
    } catch {
      malformed = true;
    }
  }
  if (parsed.size === 1) return { type: "ok", value: [...parsed.values()][0]! };
  if (parsed.size === 0 && malformed) {
    return { type: "error", code: "cache_manifest_malformed", explanation: "DNS cache manifest record was malformed" };
  }
  return { type: "error", code: "cache_manifest_ambiguous", explanation: "DNS cache manifest TXT set contained conflicting valid records" };
}

function parseUniqueChunk(records: string[], expectedIndex: number): ParseResult<CacheChunkRecord> {
  const parsed = new Map<string, CacheChunkRecord>();
  let malformed = false;
  for (const record of records) {
    try {
      const chunk = parseCacheChunkRecord(record);
      if (chunk.index !== expectedIndex) {
        malformed = true;
      } else {
        parsed.set(`${chunk.index}\0${chunk.data}`, chunk);
      }
    } catch {
      malformed = true;
    }
  }
  if (parsed.size === 1) return { type: "ok", value: [...parsed.values()][0]! };
  if (parsed.size === 0 && malformed) {
    return { type: "error", code: "cache_chunk_malformed", explanation: "DNS cache chunk record was malformed" };
  }
  return { type: "error", code: "cache_chunk_ambiguous", explanation: "DNS cache chunk TXT set contained conflicting valid records" };
}

function parseUniqueIdentity(records: string[]): ParseResult<IdentityRecord> {
  const parsed = new Map<string, IdentityRecord>();
  for (const record of records) {
    try {
      const identity = parseIdentityRecord(record);
      parsed.set(`${identity.kid}\0${canonicalizeJson(identity.publicKeyJwk)}`, identity);
    } catch {
      // Try the next TXT record.
    }
  }
  if (parsed.size === 0) {
    return { type: "error", code: "identity_malformed", explanation: "TrueName identity record was malformed" };
  }
  if (parsed.size > 1) {
    return { type: "error", code: "identity_ambiguous", explanation: "TrueName identity TXT set contained conflicting valid records" };
  }
  return { type: "ok", value: [...parsed.values()][0]! };
}

async function reconstructReceiptFromCache(
  contentHash: string,
  signerDomain: string,
  manifest: CacheManifestRecord,
  resolver: TrueNameResolver,
): Promise<{ type: "ok"; receipt: ProofReceipt } | { type: "error"; code: string; explanation: string }> {
  const chunks: string[] = [];
  for (let index = 0; index < manifest.chunkCount; index++) {
    let lookup: TxtLookupResult;
    try {
      lookup = await resolver.resolveTxt(cacheChunkName(contentHash, signerDomain, index));
    } catch {
      return { type: "error", code: "resolver_error", explanation: "TrueName resolver failed during DNS cache chunk lookup" };
    }
    if (lookup.type !== "found") {
      return { type: "error", code: "dns_cache_chunk_missing", explanation: lookup.explanation };
    }
    if (lookup.dnssecValidated !== true) {
      return { type: "error", code: "dnssec_not_validated", explanation: "DNS cache chunk lookup was not DNSSEC validated" };
    }
    const chunkResult = parseUniqueChunk(lookup.records, index);
    if (chunkResult.type !== "ok") {
      return { type: "error", code: chunkResult.code, explanation: chunkResult.explanation };
    }
    chunks.push(chunkResult.value.data);
  }
  const payload = chunks.join("");
  if (sha256(payload) !== manifest.payloadHash) {
    return {
      type: "error",
      code: "dns_cache_payload_hash_mismatch",
      explanation: "Reconstructed DNS cache payload hash did not match manifest",
    };
  }
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    return { type: "ok", receipt: JSON.parse(json) as ProofReceipt };
  } catch {
    return { type: "error", code: "dns_cache_payload_malformed", explanation: "DNS cache payload was not a receipt JSON object" };
  }
}

function parseDohBody(body: unknown): { Status: number; AD?: boolean; Answer?: Array<{ type?: number; data?: string }> } | null {
  if (!isRecord(body) || typeof body.Status !== "number") return null;
  if (body.AD !== undefined && typeof body.AD !== "boolean") return null;
  if (body.Answer !== undefined) {
    if (!Array.isArray(body.Answer) || !body.Answer.every(isRecord)) return null;
    for (const answer of body.Answer) {
      if (answer.type !== undefined && typeof answer.type !== "number") return null;
      if (answer.data !== undefined && typeof answer.data !== "string") return null;
    }
  }
  return body as { Status: number; AD?: boolean; Answer?: Array<{ type?: number; data?: string }> };
}

function isFetchedReceiptShape(value: unknown): value is ProofReceipt {
  if (!isRecord(value)) return false;
  return (
    typeof value.signerDomain === "string" &&
    typeof value.signerKeyId === "string" &&
    typeof value.candidateHash === "string" &&
    Array.isArray(value.contentHashes)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseKvRecord(record: string, version: string): Map<string, string> {
  const cleaned = record.trim();
  const [prefix, ...tokens] = cleaned.split(/\s+/);
  if (prefix !== version) throw new Error("record_version_mismatch");
  const out = new Map<string, string>();
  for (const token of tokens) {
    const idx = token.indexOf("=");
    if (idx <= 0) throw new Error("record_malformed");
    out.set(token.slice(0, idx), token.slice(idx + 1));
  }
  return out;
}

function dnsSafeHashLabel(hash: string): string {
  return hash.replace(/^sha256:/, "").toLowerCase().replace(/_/g, "-").replace(/[^a-z0-9-]/g, "-");
}

function normalizeDomain(domain: string): string {
  return domain.trim().replace(/\.$/, "").toLowerCase();
}

function normalizeName(name: string): string {
  return normalizeDomain(name);
}

function base64urlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function decodeTxtData(data: string): string {
  const quoted = [...data.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? "");
  return quoted.length > 0 ? quoted.join("") : data;
}

function chunkString(value: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize));
  }
  return chunks;
}

function stripSha256(value: string): string {
  return value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
}

function ensureSha256(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function state(stateValue: TrueNameState, code: string, explanation: string): TrueNameVerifyResult {
  return { state: stateValue, code, explanation };
}
