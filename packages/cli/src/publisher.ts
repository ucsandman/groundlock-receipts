import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createClaimStatusRecord,
  createDohTxtResolver,
  createDnsCacheRecords,
  createKeyStatusRecord,
  createC2paInteropSidecar,
  createLocalTrueNameResolver,
  digestText,
  generateSigningKey,
  issueVerifiedReceipt,
  receiptStatusHash,
  verifyTrueName,
  type ClaimStatusRecord,
  type DnsCacheRecords,
  type KeyStatusRecord,
  type ProofReceipt,
  type SourceOfTruth,
  type StatusLookup,
  type StatusResolver,
  type StatusRecord,
  type StatusLookupResult,
  type TrueNameVerifyResult,
} from "@groundlock/core";

export const MAX_INPUT_BYTES = 1_000_000;
const DNS_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface SignFileOptions {
  filePath: string;
  sourcePath: string;
  domain: string;
  kid: string;
  privateKeyJwk: JsonWebKey;
  outPath?: string;
  contentClass?: string;
  c2paSidecarPath?: string;
  receiptReference?: string;
  assetFormat?: string;
}

export interface SignFileResult {
  state: "PASS" | "BLOCK";
  exitCode: number;
  receipt: ProofReceipt;
  receiptPath: string;
  c2paSidecarPath?: string;
}

export interface SetupDomainOptions {
  receipt: ProofReceipt;
  publicKeyJwk: JsonWebKey;
  chunkSize?: number;
}

export interface SetupDomainRecords extends DnsCacheRecords {
  mutatesDns: false;
}

export interface LocalPublishOptions extends SignFileOptions {
  publicKeyJwk: JsonWebKey;
  outDir: string;
}

export interface LocalPublishResult {
  state: "PASS" | "BLOCK";
  exitCode: number;
  receiptPath: string;
  statusPath: string;
  fixturePath: string;
  records: SetupDomainRecords;
}

export interface VerifyLiveOptions {
  input: string;
  domain: string;
  dohEndpoint: string;
  statusBaseUrl: string;
}

export interface ExportWebEnvOptions {
  fixturePath: string;
  statusBaseUrl: string;
  dohEndpoint: string;
  siteUrl?: string;
}

export interface WarmDnsCacheOptions {
  fixturePath: string;
  dohEndpoint: string;
}

export interface WarmDnsCacheResult {
  state: "PASS" | "UNVERIFIABLE";
  checked: number;
  failures: Array<{ name: string; code: string; explanation: string }>;
}

export interface GenerateKeyFilesOptions {
  kid: string;
  outDir: string;
}

export interface GenerateKeyFilesResult {
  kid: string;
  privateKeyPath: string;
  publicKeyPath: string;
}

interface DnsFixture {
  domain: string;
  txt: Record<string, string[]>;
  status: { key: KeyStatusRecord; claim: ClaimStatusRecord };
}

export async function generateKeyFiles(opts: GenerateKeyFilesOptions): Promise<GenerateKeyFilesResult> {
  await mkdir(opts.outDir, { recursive: true });
  const key = generateSigningKey(opts.kid);
  const baseName = safeFileName(opts.kid);
  const privateKeyPath = path.join(opts.outDir, `${baseName}.private.jwk`);
  const publicKeyPath = path.join(opts.outDir, `${baseName}.public.jwk`);

  await writeFile(privateKeyPath, `${JSON.stringify(key.privateKeyJwk, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await writeFile(publicKeyPath, `${JSON.stringify(key.publicKeyJwk, null, 2)}\n`, "utf8");

  return { kid: opts.kid, privateKeyPath, publicKeyPath };
}

export async function signFile(opts: SignFileOptions): Promise<SignFileResult> {
  const candidate = await readTextCapped(opts.filePath);
  const source = validateSourceOfTruth(await readJsonFileCapped(opts.sourcePath));
  const receipt = issueVerifiedReceipt(
    candidate,
    source,
    { kid: opts.kid, privateKeyJwk: opts.privateKeyJwk },
    new Date().toISOString(),
    {
      signerDomain: opts.domain,
      contentClass: opts.contentClass ?? "publisher-file",
    },
  );
  const receiptPath = opts.outPath ?? `${opts.filePath}.groundlock-receipt.json`;
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), "utf8");
  if (opts.c2paSidecarPath) {
    await mkdir(path.dirname(opts.c2paSidecarPath), { recursive: true });
    const sidecar = createC2paInteropSidecar(receipt, {
      assetFormat: opts.assetFormat ?? "text/plain",
      receiptReference: opts.receiptReference ?? receiptPath,
    });
    await writeFile(opts.c2paSidecarPath, JSON.stringify(sidecar, null, 2), "utf8");
  }
  return {
    state: receipt.verdict === "pass" ? "PASS" : "BLOCK",
    exitCode: receipt.verdict === "pass" ? 0 : 2,
    receipt,
    receiptPath,
    ...(opts.c2paSidecarPath ? { c2paSidecarPath: opts.c2paSidecarPath } : {}),
  };
}

export function setupDomainRecords(opts: SetupDomainOptions): SetupDomainRecords {
  return { mutatesDns: false, ...createDnsCacheRecords(opts.receipt, opts.publicKeyJwk, { chunkSize: opts.chunkSize }) };
}

export function formatDnsZoneRecords(records: DnsCacheRecords, ttl = 300): string {
  if (!Number.isInteger(ttl) || ttl < 1) throw new Error("invalid_ttl");
  const zoneRecords = [records.identity, records.manifest, ...records.chunks];
  return `${zoneRecords.map((record) => formatZoneTxtRecord(record.name, record.value, ttl)).join("\n")}\n`;
}

export async function localPublish(opts: LocalPublishOptions): Promise<LocalPublishResult> {
  await mkdir(opts.outDir, { recursive: true });
  const receiptFileName = safeFileName(digestText(await readTextCapped(opts.filePath))) + ".json";
  const receiptPath = path.join(opts.outDir, "receipts", receiptFileName);
  const signed = await signFile({ ...opts, outPath: receiptPath });
  const receiptHash = receiptStatusHash(signed.receipt);
  const keyStatus = createKeyStatusRecord({
    signerDomain: opts.domain,
    kid: opts.kid,
    status: "active",
    issuedAt: signed.receipt.issuedAt,
  });
  const claimStatus = createClaimStatusRecord({
    receiptHash,
    status: "active",
    issuedAt: signed.receipt.issuedAt,
  });
  const statusDir = path.join(opts.outDir, "status");
  await mkdir(statusDir, { recursive: true });
  const statusPath = path.join(statusDir, "claim.json");
  await writeFile(path.join(statusDir, "key.json"), JSON.stringify(keyStatus, null, 2), "utf8");
  await writeFile(statusPath, JSON.stringify(claimStatus, null, 2), "utf8");

  const records = setupDomainRecords({
    receipt: signed.receipt,
    publicKeyJwk: opts.publicKeyJwk,
  });
  const fixture: DnsFixture = {
    domain: opts.domain,
    txt: dnsTxtFromRecords(records),
    status: { key: keyStatus, claim: claimStatus },
  };
  const fixturePath = path.join(opts.outDir, "dns-fixture.json");
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2), "utf8");
  return { state: signed.state, exitCode: signed.exitCode, receiptPath, statusPath, fixturePath, records };
}

export async function verifyWithFixture(opts: {
  input: string;
  fixturePath: string;
  domain?: string;
}): Promise<TrueNameVerifyResult> {
  const fixture = validateFixture(await readJsonFileCapped(opts.fixturePath));
  const contentHash = opts.input.startsWith("sha256:") ? opts.input : digestText(await readTextCapped(opts.input));
  const statusResolver: StatusResolver = {
    resolveKeyStatus: async () => ({ type: "found", record: fixture.status.key }),
    resolveClaimStatus: async () => ({ type: "found", record: fixture.status.claim }),
  };
  return verifyTrueName(
    contentHash,
    opts.domain ?? fixture.domain,
    createLocalTrueNameResolver({
      txt: fixture.txt,
      statusResolver,
    }),
  );
}

export async function verifyLive(opts: VerifyLiveOptions): Promise<TrueNameVerifyResult> {
  const dohEndpoint = requireHttpsUrl(opts.dohEndpoint, "missing_doh_endpoint", "invalid_doh_endpoint");
  const statusBaseUrl = requireHttpsUrl(opts.statusBaseUrl, "missing_status_base_url", "invalid_status_base_url");
  const contentHash = opts.input.startsWith("sha256:") ? opts.input : digestText(await readTextCapped(opts.input));
  const fetcher = fetchJson;
  return verifyTrueName(contentHash, opts.domain, {
    ...createDohTxtResolver(fetcher, dohEndpoint),
    statusResolver: createHttpStatusResolver(fetcher, statusBaseUrl),
  });
}

export async function exportWebEnv(opts: ExportWebEnvOptions): Promise<string> {
  const dohEndpoint = requireHttpsUrl(opts.dohEndpoint, "missing_doh_endpoint", "invalid_doh_endpoint");
  const statusBaseUrl = requireHttpsUrl(opts.statusBaseUrl, "missing_status_base_url", "invalid_status_base_url");
  const fixture = validateFixture(await readJsonFileCapped(opts.fixturePath));
  const records = [fixture.status.key, fixture.status.claim];
  const lines = [
    `GROUNDLOCK_SIGNER_DOMAIN=${fixture.domain}`,
    ...(opts.siteUrl ? [`NEXT_PUBLIC_SITE_URL=${normalizeUrlOrigin(opts.siteUrl)}`] : []),
    `GROUNDLOCK_DOH_ENDPOINT=${dohEndpoint}`,
    `GROUNDLOCK_STATUS_BASE_URL=${statusBaseUrl}`,
    `GROUNDLOCK_STATUS_RECORDS_JSON=${JSON.stringify(records)}`,
  ];
  return `${lines.join("\n")}\n`;
}

export async function warmDnsCache(opts: WarmDnsCacheOptions): Promise<WarmDnsCacheResult> {
  const dohEndpoint = requireHttpsUrl(opts.dohEndpoint, "missing_doh_endpoint", "invalid_doh_endpoint");
  const fixture = validateFixture(await readJsonFileCapped(opts.fixturePath));
  const resolver = createDohTxtResolver(fetchJson, dohEndpoint);
  const failures: WarmDnsCacheResult["failures"] = [];
  const names = Object.keys(fixture.txt).sort();

  for (const name of names) {
    const expected = fixture.txt[name] ?? [];
    const lookup = await resolver.resolveTxt(name);
    if (lookup.type !== "found") {
      failures.push({ name, code: lookup.code, explanation: lookup.explanation });
      continue;
    }
    if (lookup.dnssecValidated !== true) {
      failures.push({ name, code: "dnssec_not_validated", explanation: "DNS TXT lookup was not DNSSEC validated" });
      continue;
    }
    if (!sameTxtSet(expected, lookup.records)) {
      failures.push({ name, code: "dns_txt_mismatch", explanation: "DoH TXT answer did not match expected cache fixture records" });
    }
  }

  return {
    state: failures.length === 0 ? "PASS" : "UNVERIFIABLE",
    checked: names.length,
    failures,
  };
}

async function readTextCapped(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  if (data.byteLength > MAX_INPUT_BYTES) throw new Error("input_too_large");
  return data.toString("utf8");
}

async function readJsonFileCapped(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readTextCapped(filePath));
  } catch {
    throw new Error("invalid_json");
  }
}

function validateSourceOfTruth(value: unknown): SourceOfTruth {
  if (!isRecord(value) || !Array.isArray(value.requiredFacts) || !Array.isArray(value.allowedFacts)) {
    throw new Error("invalid_source_of_truth");
  }
  for (const fact of [...value.requiredFacts, ...value.allowedFacts]) {
    if (!isRecord(fact) || typeof fact.label !== "string" || typeof fact.value !== "string") {
      throw new Error("invalid_source_of_truth");
    }
  }
  return value as unknown as SourceOfTruth;
}

function validateFixture(value: unknown): DnsFixture {
  if (!isRecord(value) || typeof value.domain !== "string" || !isRecord(value.txt) || !isRecord(value.status)) {
    throw new Error("invalid_fixture");
  }
  return value as unknown as DnsFixture;
}

function dnsTxtFromRecords(records: DnsCacheRecords): Record<string, string[]> {
  const txt: Record<string, string[]> = {
    [records.identity.name]: [records.identity.value],
    [records.manifest.name]: [records.manifest.value],
  };
  for (const chunk of records.chunks) {
    txt[chunk.name] = [chunk.value];
  }
  return txt;
}

function formatZoneTxtRecord(name: string, value: string, ttl: number): string {
  return `${fqdn(name)} ${ttl} IN TXT ${formatTxtRdata(value)}`;
}

function fqdn(name: string): string {
  return name.endsWith(".") ? name : `${name}.`;
}

function formatTxtRdata(value: string): string {
  return txtSegments(value).map(quoteTxtSegment).join(" ");
}

function txtSegments(value: string): string[] {
  const segments: string[] = [];
  for (let offset = 0; offset < value.length; offset += 255) {
    segments.push(value.slice(offset, offset + 255));
  }
  return segments.length > 0 ? segments : [""];
}

function quoteTxtSegment(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function normalizeUrlOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (!isLaunchHttpsUrl(url)) throw new Error("invalid_site_url");
    return url.origin;
  } catch {
    throw new Error("invalid_site_url");
  }
}

function requireHttpsUrl(value: string | undefined, missingError: string, invalidError: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(missingError);
  }
  const raw = value.trim();
  try {
    const url = new URL(raw);
    if (!isLaunchHttpsUrl(url)) throw new Error(invalidError);
    return raw;
  } catch {
    throw new Error(invalidError);
  }
}

function isLaunchHttpsUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    isDnsHostname(url.hostname) &&
    url.username === "" &&
    url.password === "" &&
    url.search === "" &&
    url.hash === ""
  );
}

function isDnsHostname(hostname: string): boolean {
  const host = hostname.trim().replace(/\.$/, "").toLowerCase();
  if (!host || host.length > 253 || !host.includes(".")) return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":") || host.includes("[")) {
    return false;
  }
  return host.split(".").every((label) => DNS_LABEL_RE.test(label));
}

function sameTxtSet(left: string[], right: string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

type FetchJson = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

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
