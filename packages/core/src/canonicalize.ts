import { createHash } from "node:crypto";

const LONG_DASHES = /[‒–—―]/g; // figure/en/em dash, horizontal bar
const HYPHEN_VARIANTS = /[‐‑−]/g; // hyphen, non-breaking hyphen, minus
const SINGLE_QUOTES = /[‘’‚‛]/g;
const DOUBLE_QUOTES = /[“”„‟]/g;
const ELLIPSIS = /…/g;
const NBSP = / /g;

/** Normalize text for comparison: NFC plus ASCII dash/quote/ellipsis hygiene. Idempotent. */
export function canonicalizeText(input: string): string {
  return input
    .normalize("NFC")
    .replace(LONG_DASHES, "-")
    .replace(HYPHEN_VARIANTS, "-")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(ELLIPSIS, "...")
    .replace(NBSP, " ");
}

/** Deterministic JSON: sorted keys, NFC string values, no whitespace, undefined dropped. */
export function canonicalizeJson(value: unknown): string {
  return serialize(value);
}

function serialize(value: unknown): string {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "string") return JSON.stringify((value as string).normalize("NFC"));
  if (t === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (t === "boolean") return JSON.stringify(value);
  if (t === "bigint" || t === "function" || t === "symbol" || t === "undefined") return "null";
  if (Array.isArray(value)) {
    return "[" + value.map((v) => (v === undefined ? "null" : serialize(v))).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k.normalize("NFC")) + ":" + serialize(obj[k])).join(",") +
    "}"
  );
}

/** 'sha256:' + base64url(sha256(utf8(canonical))). */
export function sha256(canonical: string): string {
  return "sha256:" + createHash("sha256").update(canonical, "utf8").digest("base64url");
}

export function digestText(input: string): string {
  return sha256(canonicalizeText(input));
}

export function digestJson(value: unknown): string {
  return sha256(canonicalizeJson(value));
}
