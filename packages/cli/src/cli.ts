#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  exportWebEnv,
  formatDnsZoneRecords,
  createLaunchKit,
  generateKeyFiles,
  localPublish,
  setupDomainRecords,
  signFile,
  warmDnsCache,
  verifyLive,
  verifyWithFixture,
  type SetupDomainRecords,
} from "./publisher.js";
import type { ProofReceipt } from "@groundlock/core";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, first, ...rest] = argv;
  const opts = parseFlags(rest);
  try {
    if (command === "generate-key") {
      requireValue(first, "kid");
      const result = await generateKeyFiles({
        kid: first,
        outDir: requireFlag(opts, "out"),
      });
      process.stdout.write(`kid ${result.kid}\n`);
      process.stdout.write(`private-key ${result.privateKeyPath}\n`);
      process.stdout.write(`public-key ${result.publicKeyPath}\n`);
      return 0;
    }
    if (command === "sign") {
      requireValue(first, "file");
      const result = await signFile({
        filePath: first,
        sourcePath: requireFlag(opts, "source"),
        domain: requireFlag(opts, "domain"),
        kid: requireFlag(opts, "kid"),
        privateKeyJwk: await readJsonArg(requireFlag(opts, "key")),
        outPath: opts.out,
        c2paSidecarPath: opts["c2pa-sidecar"],
        receiptReference: opts["receipt-ref"],
        assetFormat: opts["asset-format"],
      });
      process.stdout.write(`${result.state} receipt written to ${result.receiptPath}\n`);
      if (result.c2paSidecarPath) {
        process.stdout.write(`c2pa sidecar ${result.c2paSidecarPath}\n`);
      }
      return result.exitCode;
    }
    if (command === "verify") {
      requireValue(first, "file-or-hash");
      const result = await verifyWithFixture({
        input: first,
        fixturePath: requireFlag(opts, "fixture"),
        domain: opts.domain,
      });
      process.stdout.write(`${result.state} ${result.code} - ${result.explanation}\n`);
      return result.state === "PASS" ? 0 : 2;
    }
    if (command === "check-live") {
      requireValue(first, "file-or-hash");
      const result = await verifyLive({
        input: first,
        domain: requireFlag(opts, "domain"),
        statusBaseUrl: requireFlag(opts, "status-base-url"),
        dohEndpoint: requireFlag(opts, "doh-endpoint"),
      });
      process.stdout.write(`${result.state} ${result.code} - ${result.explanation}\n`);
      return result.state === "PASS" ? 0 : 2;
    }
    if (command === "export-web-env") {
      requireValue(first, "dns-fixture");
      process.stdout.write(await exportWebEnv({
        fixturePath: first,
        statusBaseUrl: requireFlag(opts, "status-base-url"),
        dohEndpoint: requireFlag(opts, "doh-endpoint"),
        siteUrl: opts["site-url"],
      }));
      return 0;
    }
    if (command === "warm-cache") {
      requireValue(first, "dns-fixture");
      const result = await warmDnsCache({
        fixturePath: first,
        dohEndpoint: requireFlag(opts, "doh-endpoint"),
      });
      process.stdout.write(`${result.state} warmed ${result.checked} DNS TXT names\n`);
      for (const failure of result.failures) {
        process.stdout.write(`${failure.name} ${failure.code} - ${failure.explanation}\n`);
      }
      return result.state === "PASS" ? 0 : 2;
    }
    if (command === "launch-kit") {
      requireValue(first, "dns-fixture");
      const result = await createLaunchKit({
        fixturePath: first,
        outDir: requireFlag(opts, "out"),
        siteUrl: requireFlag(opts, "site-url"),
        statusBaseUrl: requireFlag(opts, "status-base-url"),
        dohEndpoint: requireFlag(opts, "doh-endpoint"),
        fileOrHash: requireFlag(opts, "file-or-hash"),
        ttl: optionalPositiveInt(opts.ttl),
        repo: opts.repo,
        branch: opts.branch,
        showHnDraft: opts["show-hn-draft"],
      });
      process.stdout.write(`launch-kit ${result.outDir}\n`);
      process.stdout.write(`content-hash ${result.contentHash}\n`);
      process.stdout.write(`receipt-hash ${result.receiptHash}\n`);
      for (const [name, filePath] of Object.entries(result.artifacts)) {
        process.stdout.write(`${name} ${filePath}\n`);
      }
      return 0;
    }
    if (command === "setup-domain") {
      requireValue(first, "domain");
      const receipt = await readJsonArg<ProofReceipt>(requireFlag(opts, "receipt"));
      if (receipt.signerDomain.toLowerCase() !== first.toLowerCase()) {
        throw new Error("receipt_domain_mismatch");
      }
      const records = setupDomainRecords({
        receipt,
        publicKeyJwk: await readJsonArg<JsonWebKey>(requireFlag(opts, "public-key")),
        chunkSize: optionalInt(opts["chunk-size"]),
      });
      const format = opts.format ?? "text";
      if (format === "zone") {
        process.stdout.write(formatDnsZoneRecords(records, optionalPositiveInt(opts.ttl) ?? 300));
      } else if (format === "text") {
        writeDnsCacheRecords(records);
      } else {
        throw new Error("invalid_format");
      }
      process.stdout.write("DNS mutation: none\n");
      return 0;
    }
    if (command === "local-publish") {
      requireValue(first, "file");
      const result = await localPublish({
        filePath: first,
        sourcePath: requireFlag(opts, "source"),
        domain: requireFlag(opts, "domain"),
        kid: requireFlag(opts, "kid"),
        privateKeyJwk: await readJsonArg(requireFlag(opts, "key")),
        publicKeyJwk: await readJsonArg(requireFlag(opts, "public-key")),
        outDir: requireFlag(opts, "out"),
      });
      process.stdout.write(`receipt ${result.receiptPath}\n`);
      process.stdout.write(`status ${result.statusPath}\n`);
      process.stdout.write(`fixture ${result.fixturePath}\n`);
      process.stdout.write(`state ${result.state}\n`);
      writeDnsCacheRecords(result.records);
      return result.exitCode;
    }
    process.stderr.write(help());
    return 1;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    process.stderr.write(`ERROR ${msg}\n`);
    return 1;
  }
}

function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token?.startsWith("--")) throw new Error(`unexpected_arg:${token}`);
    const key = token.slice(2);
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`missing_flag_value:${key}`);
    out[key] = value;
  }
  return out;
}

async function readJsonArg<T = JsonWebKey>(value: string): Promise<T> {
  const raw = value.trim().startsWith("{") ? value : await readFile(value, "utf8");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("invalid_json");
  }
}

function requireFlag(opts: Record<string, string>, key: string): string {
  const value = opts[key];
  if (!value) throw new Error(`missing_flag:${key}`);
  return value;
}

function requireValue(value: string | undefined, name: string): asserts value is string {
  if (!value) throw new Error(`missing_${name}`);
}

function optionalInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error("invalid_integer");
  return parsed;
}

function optionalPositiveInt(value: string | undefined): number | undefined {
  const parsed = optionalInt(value);
  if (parsed !== undefined && parsed < 1) throw new Error("invalid_integer");
  return parsed;
}

function writeDnsCacheRecords(records: SetupDomainRecords): void {
  process.stdout.write(`${records.identity.name} TXT ${records.identity.value}\n`);
  process.stdout.write(`cache-manifest ${records.manifest.name} TXT ${records.manifest.value}\n`);
  for (const chunk of records.chunks) {
    process.stdout.write(`cache-chunk ${chunk.index} ${chunk.name} TXT ${chunk.value}\n`);
  }
}

function help(): string {
  return [
    "groundlock generate-key <kid> --out <dir>",
    "groundlock sign <file> --source <json> --domain <domain> --kid <kid> --key <jwk> [--out <receipt>] [--c2pa-sidecar <json>] [--receipt-ref <url-or-path>] [--asset-format <media-type>]",
    "groundlock verify <file|hash> --fixture <dns-fixture.json> [--domain <domain>]",
    "groundlock check-live <file|hash> --domain <domain> --status-base-url <url> --doh-endpoint <url>",
    "groundlock export-web-env <dns-fixture.json> --status-base-url <url> --doh-endpoint <url> [--site-url <url>]",
    "groundlock warm-cache <dns-fixture.json> --doh-endpoint <url>",
    "groundlock launch-kit <dns-fixture.json> --out <dir> --site-url <url> --status-base-url <url> --doh-endpoint <url> --file-or-hash <file|sha256> [--ttl <seconds>] [--repo <owner/repo>] [--branch <name>] [--show-hn-draft <path>]",
    "groundlock setup-domain <domain> --receipt <receipt.json> --public-key <jwk> [--chunk-size <chars>] [--format text|zone] [--ttl <seconds>]",
    "groundlock local-publish <file> --source <json> --domain <domain> --kid <kid> --key <jwk> --public-key <jwk> --out <dir>",
  ].join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
