#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  localPublish,
  setupDomainRecords,
  signFile,
  verifyWithFixture,
  type SetupDomainRecords,
} from "./publisher.js";
import type { ProofReceipt } from "@groundlock/core";

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const [command, first, ...rest] = argv;
  const opts = parseFlags(rest);
  try {
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
      writeDnsCacheRecords(records);
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

function writeDnsCacheRecords(records: SetupDomainRecords): void {
  process.stdout.write(`${records.identity.name} TXT ${records.identity.value}\n`);
  process.stdout.write(`cache-manifest ${records.manifest.name} TXT ${records.manifest.value}\n`);
  for (const chunk of records.chunks) {
    process.stdout.write(`cache-chunk ${chunk.index} ${chunk.name} TXT ${chunk.value}\n`);
  }
}

function help(): string {
  return [
    "groundlock sign <file> --source <json> --domain <domain> --kid <kid> --key <jwk> [--out <receipt>] [--c2pa-sidecar <json>] [--receipt-ref <url-or-path>] [--asset-format <media-type>]",
    "groundlock verify <file|hash> --fixture <dns-fixture.json> [--domain <domain>]",
    "groundlock setup-domain <domain> --receipt <receipt.json> --public-key <jwk> [--chunk-size <chars>]",
    "groundlock local-publish <file> --source <json> --domain <domain> --kid <kid> --key <jwk> --public-key <jwk> --out <dir>",
  ].join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
