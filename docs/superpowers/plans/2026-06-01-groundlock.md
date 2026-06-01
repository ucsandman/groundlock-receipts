# GroundLock v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a vendor-neutral non-fabrication engine that verifies an AI-drafted message against a structured source of truth and returns PASS or BLOCK plus a signed, re-verifiable proof receipt, with a minimal web playground to demo it.

**Architecture:** A monorepo (npm workspaces). `packages/core` is a zero-runtime-dependency TypeScript package (canonicalize, extract, verify, ruleset, keys, receipt, guarantee) using only `node:crypto`. `apps/web` is a Next.js 15 + Tailwind app with one `/api/verify` route and a playground page that consumes the core. The core never imports from the app.

**Tech Stack:** TypeScript (strict), npm workspaces, Vitest, Next.js 15 (App Router), Tailwind, Ed25519 via `node:crypto`.

Spec: `docs/superpowers/specs/2026-06-01-groundlock-design.md`.

**Conventions for every task below:**
- Files use ASCII-only source (write Unicode glyphs as `\u` escapes), per repo convention on Windows.
- Run all core commands from `packages/core` unless stated. Run web commands from `apps/web`.
- Commit messages have no scope-creep; one logical change per commit.

---

## Task 0: Monorepo scaffold and tooling

**Files:**
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts` (temporary empty barrel)

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "groundlock",
  "private": true,
  "version": "0.1.0",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "npm run test --workspace @groundlock/core",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "build": "npm run build --workspaces --if-present"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
node_modules/
dist/
.next/
out/
coverage/
*.tsbuildinfo
.env
.env.local
.DS_Store
```

- [ ] **Step 4: Create `.env.example`**

```dotenv
# GroundLock demo. v1 generates an in-memory signing key per process; no secret required to run.
# Optional: provide a stable Ed25519 private key (JWK, single line) so receipts verify across restarts.
GROUNDLOCK_SIGNING_KEY_JWK=
GROUNDLOCK_SIGNING_KID=demo-key-1
```

- [ ] **Step 5: Create `packages/core/package.json`**

```json
{
  "name": "@groundlock/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "@types/node": "^20.14.0"
  }
}
```

- [ ] **Step 6: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"], "outDir": "dist", "rootDir": "src" },
  "include": ["src", "tests"]
}
```

- [ ] **Step 7: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 8: Create temporary `packages/core/src/index.ts`**

```ts
export {};
```

- [ ] **Step 9: Install and verify the workspace resolves**

Run: `npm install`
Expected: completes without error; `node_modules` created at root.

Run: `npm run typecheck --workspace @groundlock/core`
Expected: PASS (no type errors over an empty package).

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.base.json .gitignore .env.example packages/core
git commit -m "chore: scaffold groundlock monorepo and core package"
```

---

## Task 1: Core types

**Files:**
- Create: `packages/core/src/types.ts`

- [ ] **Step 1: Create `packages/core/src/types.ts`**

```ts
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

export interface ProofReceipt {
  version: "groundlock-receipt/v1";
  issuedAt: string;
  engineVersion: string;
  verdict: "pass" | "block";
  violations: ReceiptViolation[];
  candidateHash: string;
  sourceOfTruthHash: string;
  signature: { alg: "EdDSA"; kid: string; sig: string };
}

export interface SigningKey {
  kid: string;
  privateKeyJwk: JsonWebKey;
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run typecheck --workspace @groundlock/core`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): add engine type definitions"
```

---

## Task 2: Canonicalization and hashing

**Files:**
- Create: `packages/core/src/canonicalize.ts`
- Test: `packages/core/tests/canonicalize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  canonicalizeText,
  canonicalizeJson,
  sha256,
  digestText,
  digestJson,
} from "../src/canonicalize";

describe("canonicalizeText", () => {
  it("is idempotent", () => {
    const s = "Smart “quotes” and an em—dash.";
    expect(canonicalizeText(canonicalizeText(s))).toBe(canonicalizeText(s));
  });

  it("normalizes smart quotes, dashes, and ellipsis to ASCII", () => {
    const out = canonicalizeText("“Hi” — wait… it’s fine");
    expect(out).toBe('"Hi" - wait... it\'s fine');
  });

  it("preserves a hyphen between digits", () => {
    expect(canonicalizeText("92.103-92.109")).toBe("92.103-92.109");
  });

  it("treats NFC and decomposed Unicode as equal", () => {
    const precomposed = "café";
    const decomposed = "café";
    expect(canonicalizeText(precomposed)).toBe(canonicalizeText(decomposed));
  });
});

describe("canonicalizeJson", () => {
  it("is independent of object key order", () => {
    expect(canonicalizeJson({ a: 1, b: 2 })).toBe(canonicalizeJson({ b: 2, a: 1 }));
  });

  it("omits undefined object values and emits no whitespace", () => {
    expect(canonicalizeJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe("sha256 / digests", () => {
  it("matches the canonical SHA-256 empty-string vector (base64url framed)", () => {
    const emptyHex =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    expect(sha256("")).toBe("sha256:" + Buffer.from(emptyHex, "hex").toString("base64url"));
  });

  it("matches the canonical SHA-256 'abc' vector", () => {
    const abcHex =
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(sha256("abc")).toBe("sha256:" + Buffer.from(abcHex, "hex").toString("base64url"));
  });

  it("digestText and digestJson are stable across calls", () => {
    expect(digestText("hello")).toBe(digestText("hello"));
    expect(digestJson({ x: 1 })).toBe(digestJson({ x: 1 }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @groundlock/core`
Expected: FAIL with "Failed to resolve import ../src/canonicalize" (module not found).

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/canonicalize.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @groundlock/core`
Expected: PASS (all canonicalize tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/canonicalize.ts packages/core/tests/canonicalize.test.ts
git commit -m "feat(core): add canonicalization and sha256 digests"
```

---

## Task 3: Operational-token extraction

**Files:**
- Create: `packages/core/src/extract.ts`
- Test: `packages/core/tests/extract.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  extractMoney,
  extractDates,
  extractPercentages,
  normalizeMoney,
  normalizeDate,
} from "../src/extract";

describe("money", () => {
  it("extracts currency amounts and normalizes formatting variants equally", () => {
    expect(extractMoney("Balance is $1,500.00 due.").map((m) => m.normalized)).toEqual(["1500"]);
    expect(normalizeMoney("$1,500.00")).toBe(normalizeMoney("$1500"));
    expect(normalizeMoney("$1,500.50")).toBe("1500.5");
  });
});

describe("dates", () => {
  it("normalizes common formats to ISO", () => {
    expect(normalizeDate("June 1, 2026")).toBe("2026-06-01");
    expect(normalizeDate("2026-06-01")).toBe("2026-06-01");
    expect(normalizeDate("6/1/2026")).toBe("2026-06-01");
  });

  it("extracts a date from text", () => {
    expect(extractDates("Due by June 1, 2026.").map((d) => d.normalized)).toEqual(["2026-06-01"]);
  });
});

describe("percentages", () => {
  it("extracts and normalizes percentages", () => {
    expect(extractPercentages("A 7.5% fee applies").map((p) => p.normalized)).toEqual(["7.5"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @groundlock/core`
Expected: FAIL with "Failed to resolve import ../src/extract".

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/extract.ts`:

```ts
export interface Extracted {
  raw: string;
  normalized: string;
}

const MONEY_RE = /\$\s?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\$\s?\d+(?:\.\d{1,2})?/g;
const PERCENT_RE = /\d+(?:\.\d+)?\s?%/g;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const SLASH_DATE_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};
const MONTH_DATE_RE = new RegExp(
  "\\b(" + Object.keys(MONTHS).join("|") + ")\\s+(\\d{1,2}),\\s*(\\d{4})\\b",
  "gi",
);

/** Strip currency formatting to a bare numeric string with no trailing zeros (e.g. "1500", "1500.5"). */
export function normalizeMoney(raw: string): string {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? String(n) : raw.trim();
}

export function normalizePercent(raw: string): string {
  const n = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? String(n) : raw.trim();
}

/** Normalize a single date string to ISO YYYY-MM-DD, or null if unrecognized. */
export function normalizeDate(raw: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (slash) return `${slash[3]}-${pad(slash[1])}-${pad(slash[2])}`;
  const month = new RegExp(
    "^(" + Object.keys(MONTHS).join("|") + ")\\s+(\\d{1,2}),\\s*(\\d{4})$",
    "i",
  ).exec(raw.trim());
  if (month) {
    const mm = MONTHS[month[1]!.toLowerCase()]!;
    return `${month[3]}-${mm}-${pad(month[2]!)}`;
  }
  return null;
}

function pad(s: string): string {
  return s.length === 1 ? "0" + s : s;
}

function matchAll(text: string, re: RegExp): string[] {
  return text.match(re) ?? [];
}

export function extractMoney(text: string): Extracted[] {
  return matchAll(text, MONEY_RE).map((raw) => ({ raw, normalized: normalizeMoney(raw) }));
}

export function extractPercentages(text: string): Extracted[] {
  return matchAll(text, PERCENT_RE).map((raw) => ({ raw, normalized: normalizePercent(raw) }));
}

export function extractDates(text: string): Extracted[] {
  const out: Extracted[] = [];
  for (const re of [ISO_DATE_RE, SLASH_DATE_RE, MONTH_DATE_RE]) {
    for (const raw of matchAll(text, re)) {
      const normalized = normalizeDate(raw);
      if (normalized) out.push({ raw, normalized });
    }
  }
  return out;
}

export function extractPattern(text: string, pattern: string): string[] {
  return matchAll(text, new RegExp(pattern, "g"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @groundlock/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/extract.ts packages/core/tests/extract.test.ts
git commit -m "feat(core): add operational-token extraction and normalization"
```

---

## Task 4: The verifier (the three checks)

**Files:**
- Create: `packages/core/src/verify.ts`
- Test: `packages/core/tests/verify.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { verify, DEFAULT_CITATION_SIGNAL } from "../src/verify";
import type { SourceOfTruth } from "../src/types";

function baseSource(): SourceOfTruth {
  return {
    requiredFacts: [
      { label: "deposit", value: "$1,500.00", slot: { prefix: "deposit was " } },
      { label: "withheld", value: "$2,000.00", slot: { prefix: "return " } },
      { label: "tenant", value: "Jane Roe" },
    ],
    allowedFacts: [
      { label: "deposit", value: "$1,500.00" },
      { label: "withheld", value: "$2,000.00" },
      { label: "dueDate", value: "June 1, 2026" },
    ],
    forbiddenPatterns: [{ label: "citation", pattern: DEFAULT_CITATION_SIGNAL }],
    extract: { money: true, dates: true, percentages: true },
  };
}

const cleanMessage =
  "My security deposit was $1,500.00. Please return $2,000.00 to Jane Roe by June 1, 2026.";

describe("required-fact check", () => {
  it("passes a clean, fully grounded message", () => {
    expect(verify(cleanMessage, baseSource()).verdict).toBe("pass");
  });

  it("blocks when a required value is altered", () => {
    const msg = cleanMessage.replace("Jane Roe", "John Doe");
    const r = verify(msg, baseSource());
    expect(r.verdict).toBe("block");
    expect(r.violations.some((v) => v.code === "missing_required" && v.label === "tenant")).toBe(true);
  });

  it("blocks when the two amounts are swapped into each other's role (slot guard)", () => {
    const msg = "My security deposit was $2,000.00. Please return $1,500.00 to Jane Roe by June 1, 2026.";
    expect(verify(msg, baseSource()).verdict).toBe("block");
  });
});

describe("positive-entailment check", () => {
  it("blocks a fabricated money amount not in allowedFacts", () => {
    const msg = cleanMessage + " A $99.00 late fee was added.";
    const r = verify(msg, baseSource());
    expect(r.verdict).toBe("block");
    expect(r.violations.some((v) => v.code === "fabricated_fact")).toBe(true);
  });

  it("accepts a formatting variant of an allowed amount", () => {
    const msg = "My security deposit was $1,500.00. Please return $2000 to Jane Roe by June 1, 2026.";
    // $2000 normalizes to the same value as the allowed $2,000.00
    expect(verify(msg, baseSource()).verdict).toBe("pass");
  });

  it("blocks a fabricated date", () => {
    const msg = cleanMessage.replace("June 1, 2026", "July 9, 2026");
    expect(verify(msg, baseSource()).verdict).toBe("block");
  });
});

describe("forbidden-pattern check", () => {
  it("blocks an invented statute citation", () => {
    const msg = cleanMessage + " Per Cal. Civ. Code section 1950.5 you must comply.";
    const r = verify(msg, baseSource());
    expect(r.verdict).toBe("block");
    expect(r.violations.some((v) => v.code === "forbidden_match")).toBe(true);
  });

  it("does not false-positive on word fragments", () => {
    const src = baseSource();
    src.forbiddenPatterns = [{ label: "competitor", pattern: "Cooper" }];
    const msg = "We met in Coopersville near Freedom Field.";
    expect(verify(msg, src).verdict).toBe("pass");
  });
});

describe("fail-closed", () => {
  it("blocks with engine_error on an invalid forbidden regex", () => {
    const src = baseSource();
    src.forbiddenPatterns = [{ label: "bad", pattern: "(" }];
    const r = verify(cleanMessage, src);
    expect(r.verdict).toBe("block");
    expect(r.violations.some((v) => v.code === "engine_error")).toBe(true);
  });
});
```

Note: `pattern: "Cooper"` is matched with word boundaries by the implementation, so "Coopersville" must not trip it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @groundlock/core`
Expected: FAIL with "Failed to resolve import ../src/verify".

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/verify.ts`:

```ts
import { canonicalizeText } from "./canonicalize";
import { extractMoney, extractDates, extractPercentages, extractPattern } from "./extract";
import type { SourceOfTruth, Violation, VerifyResult } from "./types";

/** Heuristic signal that legal-citation language is present (adapted from letter-cannon). */
export const DEFAULT_CITATION_SIGNAL =
  "\\u00A7|\\bsection\\s+\\d|\\b(?:RCW|NRS|USC|U\\.S\\.C|ORC|Civ\\.\\s*Code|Stat\\.|Code\\s+(?:Ann|of))\\b";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function wordBoundary(term: string, flags: string): RegExp {
  return new RegExp("\\b" + escapeRegExp(term) + "\\b", flags);
}

export function verify(candidate: string, source: SourceOfTruth): VerifyResult {
  try {
    const violations: Violation[] = [];
    const text = canonicalizeText(candidate);

    // 1. Required facts: each must appear verbatim, with optional role-slot to prevent swaps.
    for (const f of source.requiredFacts) {
      if (f.value.trim() === "") continue;
      const expected = canonicalizeText((f.slot?.prefix ?? "") + f.value + (f.slot?.suffix ?? ""));
      if (!text.includes(expected)) {
        violations.push({ code: "missing_required", label: f.label });
      }
    }

    // 2. Forbidden patterns: must not match unless an allowed fact authorizes them.
    //    Bare-word patterns are matched with word boundaries so "Cooper" does not
    //    match inside "Coopersville"; patterns with regex metacharacters are used as-is.
    const allowedValues = source.allowedFacts.map((a) => canonicalizeText(a.value));
    for (const p of source.forbiddenPatterns ?? []) {
      const isBareWord = /^[\w\s]+$/.test(p.pattern);
      const make = () =>
        isBareWord ? wordBoundary(p.pattern, p.flags ?? "i") : new RegExp(p.pattern, p.flags ?? "i");
      const authorized = allowedValues.some((v) => make().test(v));
      if (make().test(text) && !authorized) {
        violations.push({ code: "forbidden_match", label: p.label });
      }
    }

    // 3. Positive entailment: every extracted operational token must trace to an allowed fact.
    const ext = source.extract ?? { money: true, dates: true, percentages: true };
    const corpus = canonicalizeText(
      [...source.allowedFacts, ...source.requiredFacts].map((f) => f.value).join("\n"),
    );

    if (ext.money !== false) {
      const allowed = new Set(extractMoney(corpus).map((m) => m.normalized));
      for (const m of extractMoney(text)) {
        if (!allowed.has(m.normalized)) {
          violations.push({ code: "fabricated_fact", label: "money", detail: m.raw });
        }
      }
    }
    if (ext.dates !== false) {
      const allowed = new Set(extractDates(corpus).map((d) => d.normalized));
      for (const d of extractDates(text)) {
        if (!allowed.has(d.normalized)) {
          violations.push({ code: "fabricated_fact", label: "date", detail: d.raw });
        }
      }
    }
    if (ext.percentages !== false) {
      const allowed = new Set(extractPercentages(corpus).map((p) => p.normalized));
      for (const p of extractPercentages(text)) {
        if (!allowed.has(p.normalized)) {
          violations.push({ code: "fabricated_fact", label: "percentage", detail: p.raw });
        }
      }
    }
    for (const rp of ext.patterns ?? []) {
      for (const match of extractPattern(text, rp.pattern)) {
        if (!corpus.includes(canonicalizeText(match))) {
          violations.push({ code: "fabricated_fact", label: rp.label, detail: match });
        }
      }
    }

    return { verdict: violations.length === 0 ? "pass" : "block", violations };
  } catch (err) {
    // Fail-closed: any internal error blocks.
    return {
      verdict: "block",
      violations: [
        { code: "engine_error", label: "engine", detail: err instanceof Error ? err.message : "unknown" },
      ],
    };
  }
}
```

Note: the forbidden loop treats a bare-word pattern (such as `"Cooper"`) as a word-boundary match and a metacharacter pattern (such as the citation signal) as a raw regex. That is why the `"Cooper"` / "Coopersville" case passes while an invented citation blocks.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @groundlock/core`
Expected: PASS (all verify tests green, including swap-guard, fabricated-fact, citation, word-boundary, and fail-closed).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/verify.ts packages/core/tests/verify.test.ts
git commit -m "feat(core): add three-check verifier with fail-closed behavior"
```

---

## Task 5: Source-of-truth hashing (ruleset version)

**Files:**
- Create: `packages/core/src/ruleset.ts`
- Test: `packages/core/tests/ruleset.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { hashSourceOfTruth } from "../src/ruleset";
import type { SourceOfTruth } from "../src/types";

const src: SourceOfTruth = {
  requiredFacts: [{ label: "a", value: "x" }],
  allowedFacts: [{ label: "a", value: "x" }],
};

describe("hashSourceOfTruth", () => {
  it("is stable and sha256-framed", () => {
    expect(hashSourceOfTruth(src)).toBe(hashSourceOfTruth(src));
    expect(hashSourceOfTruth(src)).toMatch(/^sha256:[A-Za-z0-9_-]+$/);
  });

  it("changes when an allowed fact changes", () => {
    const other: SourceOfTruth = { ...src, allowedFacts: [{ label: "a", value: "y" }] };
    expect(hashSourceOfTruth(other)).not.toBe(hashSourceOfTruth(src));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @groundlock/core`
Expected: FAIL with "Failed to resolve import ../src/ruleset".

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/ruleset.ts`:

```ts
import { digestJson } from "./canonicalize";
import type { SourceOfTruth } from "./types";

/** A stable content hash of the source of truth, used as the ruleset version in a receipt. */
export function hashSourceOfTruth(source: SourceOfTruth): string {
  return digestJson({
    requiredFacts: source.requiredFacts,
    allowedFacts: source.allowedFacts,
    forbiddenPatterns: source.forbiddenPatterns ?? [],
    extract: source.extract ?? {},
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @groundlock/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ruleset.ts packages/core/tests/ruleset.test.ts
git commit -m "feat(core): add source-of-truth content hashing"
```

---

## Task 6: Ed25519 keys

**Files:**
- Create: `packages/core/src/keys.ts`
- Test: `packages/core/tests/keys.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { generateSigningKey, privateKeyFromJwk, publicKeyFromJwk } from "../src/keys";

describe("keys", () => {
  it("generates an Ed25519 OKP keypair as JWK", () => {
    const kp = generateSigningKey("k1");
    expect(kp.kid).toBe("k1");
    expect(kp.privateKeyJwk.kty).toBe("OKP");
    expect(kp.privateKeyJwk.crv).toBe("Ed25519");
    expect(typeof kp.privateKeyJwk.d).toBe("string");
    expect(kp.publicKeyJwk.d).toBeUndefined();
  });

  it("imports JWKs into usable key objects", () => {
    const kp = generateSigningKey("k1");
    expect(() => privateKeyFromJwk(kp.privateKeyJwk)).not.toThrow();
    expect(() => publicKeyFromJwk(kp.publicKeyJwk)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @groundlock/core`
Expected: FAIL with "Failed to resolve import ../src/keys".

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/keys.ts`:

```ts
import { generateKeyPairSync, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

export interface KeyPairJwk {
  kid: string;
  privateKeyJwk: JsonWebKey;
  publicKeyJwk: JsonWebKey;
}

export function generateSigningKey(kid: string): KeyPairJwk {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    kid,
    privateKeyJwk: privateKey.export({ format: "jwk" }) as JsonWebKey,
    publicKeyJwk: publicKey.export({ format: "jwk" }) as JsonWebKey,
  };
}

export function privateKeyFromJwk(jwk: JsonWebKey): KeyObject {
  return createPrivateKey({ key: jwk as object, format: "jwk" });
}

export function publicKeyFromJwk(jwk: JsonWebKey): KeyObject {
  return createPublicKey({ key: jwk as object, format: "jwk" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @groundlock/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/keys.ts packages/core/tests/keys.test.ts
git commit -m "feat(core): add Ed25519 keypair generation and JWK import"
```

---

## Task 7: Signed proof receipt

**Files:**
- Create: `packages/core/src/receipt.ts`
- Test: `packages/core/tests/receipt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { issueReceipt, verifyReceipt, ENGINE_VERSION } from "../src/receipt";
import { generateSigningKey } from "../src/keys";
import { verify } from "../src/verify";
import type { SourceOfTruth } from "../src/types";

const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "tenant", value: "Jane Roe" }],
  extract: { money: false, dates: false, percentages: false },
};
const candidate = "Dear Jane Roe, this is a notice.";
const issuedAt = "2026-06-01T00:00:00.000Z";

describe("receipt", () => {
  it("issues a receipt that round-trips verification and strips violation detail", () => {
    const kp = generateSigningKey("k1");
    const result = verify(candidate, source);
    const receipt = issueReceipt(result, candidate, source, { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk }, issuedAt);

    expect(receipt.version).toBe("groundlock-receipt/v1");
    expect(receipt.engineVersion).toBe(ENGINE_VERSION);
    expect(receipt.verdict).toBe("pass");
    expect(receipt.signature.alg).toBe("EdDSA");
    expect(receipt.candidateHash).toMatch(/^sha256:/);
    // privacy: receipt violations never carry a raw detail field
    expect(receipt.violations.every((v) => !("detail" in v))).toBe(true);

    expect(verifyReceipt(receipt, kp.publicKeyJwk)).toEqual({ ok: true });
  });

  it("fails verification when any field is tampered", () => {
    const kp = generateSigningKey("k1");
    const receipt = issueReceipt(verify(candidate, source), candidate, source, { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk }, issuedAt);

    const tampered = { ...receipt, verdict: "block" as const };
    expect(verifyReceipt(tampered, kp.publicKeyJwk).ok).toBe(false);

    const tampered2 = { ...receipt, candidateHash: "sha256:deadbeef" };
    expect(verifyReceipt(tampered2, kp.publicKeyJwk).ok).toBe(false);
  });

  it("fails closed on a malformed receipt", () => {
    const kp = generateSigningKey("k1");
    // @ts-expect-error intentionally malformed
    expect(verifyReceipt({ nonsense: true }, kp.publicKeyJwk).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @groundlock/core`
Expected: FAIL with "Failed to resolve import ../src/receipt".

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/receipt.ts`:

```ts
import { sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { canonicalizeJson, digestText } from "./canonicalize";
import { hashSourceOfTruth } from "./ruleset";
import { privateKeyFromJwk, publicKeyFromJwk } from "./keys";
import type { ProofReceipt, SigningKey, SourceOfTruth, VerifyResult } from "./types";

export const ENGINE_VERSION = "0.1.0";

export function issueReceipt(
  result: VerifyResult,
  candidate: string,
  source: SourceOfTruth,
  key: SigningKey,
  issuedAt: string,
): ProofReceipt {
  const base = {
    version: "groundlock-receipt/v1" as const,
    issuedAt,
    engineVersion: ENGINE_VERSION,
    verdict: result.verdict,
    violations: result.violations.map((v) => ({ code: v.code, label: v.label })),
    candidateHash: digestText(candidate),
    sourceOfTruthHash: hashSourceOfTruth(source),
  };
  const signingInput = canonicalizeJson(base);
  const sig = cryptoSign(null, Buffer.from(signingInput, "utf8"), privateKeyFromJwk(key.privateKeyJwk));
  return { ...base, signature: { alg: "EdDSA", kid: key.kid, sig: sig.toString("base64url") } };
}

export function verifyReceipt(
  receipt: ProofReceipt,
  publicKeyJwk: JsonWebKey,
): { ok: boolean; reason?: string } {
  try {
    if (!receipt || typeof receipt !== "object") return { ok: false, reason: "malformed" };
    const { signature, ...base } = receipt;
    if (!signature || signature.alg !== "EdDSA" || typeof signature.sig !== "string") {
      return { ok: false, reason: "unsupported_signature" };
    }
    const signingInput = canonicalizeJson(base);
    const ok = cryptoVerify(
      null,
      Buffer.from(signingInput, "utf8"),
      publicKeyFromJwk(publicKeyJwk),
      Buffer.from(signature.sig, "base64url"),
    );
    return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
  } catch {
    return { ok: false, reason: "error" }; // fail-closed
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @groundlock/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/receipt.ts packages/core/tests/receipt.test.ts
git commit -m "feat(core): add Ed25519-signed, re-verifiable proof receipts"
```

---

## Task 8: Optional generate-with-grounding orchestrator

**Files:**
- Create: `packages/core/src/guarantee.ts`
- Test: `packages/core/tests/guarantee.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { guarantee, echoRefiner } from "../src/guarantee";
import type { SourceOfTruth } from "../src/types";

const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "tenant", value: "Jane Roe" }],
  extract: { money: false, dates: false, percentages: false },
};

describe("guarantee", () => {
  it("returns the deterministic draft when no refiner is given", async () => {
    const out = await guarantee({ build: () => "Dear Jane Roe.", source });
    expect(out.source).toBe("deterministic");
    expect(out.result.verdict).toBe("pass");
  });

  it("ships model text only when it still verifies", async () => {
    const ok = await guarantee({ build: () => "Dear Jane Roe.", refiner: echoRefiner, source });
    expect(ok.source).toBe("model");

    const badRefiner = { refine: async () => "Dear John Doe." };
    const fallback = await guarantee({ build: () => "Dear Jane Roe.", refiner: badRefiner, source });
    expect(fallback.source).toBe("deterministic");
    expect(fallback.text).toContain("Jane Roe");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @groundlock/core`
Expected: FAIL with "Failed to resolve import ../src/guarantee".

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/guarantee.ts`:

```ts
import { canonicalizeText } from "./canonicalize";
import { verify } from "./verify";
import type { SourceOfTruth, VerifyResult } from "./types";

export interface Refiner {
  refine(draft: string): Promise<string>;
}

export const echoRefiner: Refiner = {
  async refine(draft: string): Promise<string> {
    return draft;
  },
};

export interface GuaranteeOptions {
  build: () => string;
  source: SourceOfTruth;
  refiner?: Refiner;
}

export interface GuaranteeResult {
  text: string;
  source: "model" | "deterministic";
  result: VerifyResult;
}

export async function guarantee(opts: GuaranteeOptions): Promise<GuaranteeResult> {
  const draft = canonicalizeText(opts.build());
  if (!opts.refiner) {
    return { text: draft, source: "deterministic", result: verify(draft, opts.source) };
  }
  try {
    const refined = canonicalizeText(await opts.refiner.refine(draft));
    const result = verify(refined, opts.source);
    if (result.verdict === "pass") return { text: refined, source: "model", result };
  } catch {
    // fall through to deterministic
  }
  return { text: draft, source: "deterministic", result: verify(draft, opts.source) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @groundlock/core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/guarantee.ts packages/core/tests/guarantee.test.ts
git commit -m "feat(core): add fail-safe generate-with-grounding orchestrator"
```

---

## Task 9: Public barrel export

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Replace `packages/core/src/index.ts`**

```ts
export * from "./types";
export { canonicalizeText, canonicalizeJson, sha256, digestText, digestJson } from "./canonicalize";
export {
  extractMoney,
  extractDates,
  extractPercentages,
  extractPattern,
  normalizeMoney,
  normalizeDate,
  normalizePercent,
  type Extracted,
} from "./extract";
export { verify, DEFAULT_CITATION_SIGNAL } from "./verify";
export { hashSourceOfTruth } from "./ruleset";
export { generateSigningKey, privateKeyFromJwk, publicKeyFromJwk, type KeyPairJwk } from "./keys";
export { issueReceipt, verifyReceipt, ENGINE_VERSION } from "./receipt";
export { guarantee, echoRefiner, type Refiner, type GuaranteeOptions, type GuaranteeResult } from "./guarantee";
```

- [ ] **Step 2: Verify typecheck and full test suite**

Run: `npm run typecheck --workspace @groundlock/core`
Expected: PASS.

Run: `npm run test --workspace @groundlock/core`
Expected: PASS (all suites: canonicalize, extract, verify, ruleset, keys, receipt, guarantee).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export public API barrel"
```

---

## Task 10: Web app scaffold (Next.js + Tailwind)

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/next.config.ts`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/postcss.config.mjs`
- Create: `apps/web/app/globals.css`
- Create: `apps/web/app/layout.tsx`

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@groundlock/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@groundlock/core": "*",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^20.14.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "@tailwindcss/postcss": "^4.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/web/next.config.ts`**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@groundlock/core"],
};

export default nextConfig;
```

- [ ] **Step 3: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] },
    "noEmit": true
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `apps/web/postcss.config.mjs`**

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

- [ ] **Step 5: Create `apps/web/app/globals.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 6: Create `apps/web/app/layout.tsx`**

```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "GroundLock", description: "Non-fabrication guarantee for AI messages" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-50 text-neutral-900">{children}</body>
    </html>
  );
}
```

- [ ] **Step 7: Install and verify the build wiring**

Run: `npm install`
Expected: completes; Next and Tailwind resolve in `apps/web`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json apps/web/next.config.ts apps/web/tsconfig.json apps/web/postcss.config.mjs apps/web/app/globals.css apps/web/app/layout.tsx package-lock.json
git commit -m "chore(web): scaffold next.js + tailwind app"
```

---

## Task 11: Verify API route and signing key

**Files:**
- Create: `apps/web/lib/signing.ts`
- Create: `apps/web/app/api/verify/route.ts`
- Create: `apps/web/app/api/key/route.ts`

- [ ] **Step 1: Create `apps/web/lib/signing.ts`**

A process-singleton signing key. Reads a stable key from env if present, otherwise generates one per process (fine for a single-instance demo).

```ts
import { generateSigningKey, type KeyPairJwk } from "@groundlock/core";

let cached: KeyPairJwk | null = null;

export function getSigningKey(): KeyPairJwk {
  if (cached) return cached;
  const kid = process.env.GROUNDLOCK_SIGNING_KID ?? "demo-key-1";
  const raw = process.env.GROUNDLOCK_SIGNING_KEY_JWK;
  if (raw) {
    const privateKeyJwk = JSON.parse(raw) as JsonWebKey;
    // Public JWK for OKP is the private JWK without the private scalar "d".
    const { d: _d, ...publicKeyJwk } = privateKeyJwk as JsonWebKey & { d?: string };
    cached = { kid, privateKeyJwk, publicKeyJwk: publicKeyJwk as JsonWebKey };
  } else {
    cached = generateSigningKey(kid);
  }
  return cached;
}
```

- [ ] **Step 2: Create `apps/web/app/api/key/route.ts`**

Publishes the public key so the client can re-verify receipts.

```ts
import { NextResponse } from "next/server";
import { getSigningKey } from "@/lib/signing";

export const runtime = "nodejs";

export function GET() {
  const { kid, publicKeyJwk } = getSigningKey();
  return NextResponse.json({ kid, publicKeyJwk });
}
```

- [ ] **Step 3: Create `apps/web/app/api/verify/route.ts`**

```ts
import { NextResponse } from "next/server";
import { verify, issueReceipt, type SourceOfTruth } from "@groundlock/core";
import { getSigningKey } from "@/lib/signing";

export const runtime = "nodejs";

interface VerifyRequestBody {
  candidate?: unknown;
  sourceOfTruth?: unknown;
}

export async function POST(req: Request) {
  let body: VerifyRequestBody;
  try {
    body = (await req.json()) as VerifyRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.candidate !== "string" || typeof body.sourceOfTruth !== "object" || body.sourceOfTruth === null) {
    return NextResponse.json({ error: "candidate (string) and sourceOfTruth (object) are required" }, { status: 400 });
  }

  const candidate = body.candidate;
  const source = body.sourceOfTruth as SourceOfTruth;
  const key = getSigningKey();

  const result = verify(candidate, source);
  const receipt = issueReceipt(
    result,
    candidate,
    source,
    { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
    new Date().toISOString(),
  );

  return NextResponse.json({ result, receipt, publicKeyJwk: key.publicKeyJwk });
}
```

- [ ] **Step 4: Verify typecheck**

Run: `npm run typecheck --workspace @groundlock/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/signing.ts apps/web/app/api
git commit -m "feat(web): add /api/verify and /api/key with demo signing key"
```

---

## Task 12: Playground page with examples and receipt re-verification

**Files:**
- Create: `apps/web/lib/examples.ts`
- Create: `apps/web/app/page.tsx`

- [ ] **Step 1: Create `apps/web/lib/examples.ts`**

Neutral business-comms example, in a clean variant and a fabricating variant. No vertical committed.

```ts
import type { SourceOfTruth } from "@groundlock/core";

export const exampleSource: SourceOfTruth = {
  requiredFacts: [
    { label: "account holder", value: "Jane Roe" },
    { label: "balance", value: "$1,500.00", slot: { prefix: "balance of " } },
    { label: "account number", value: "AC-40192" },
  ],
  allowedFacts: [
    { label: "account holder", value: "Jane Roe" },
    { label: "balance", value: "$1,500.00" },
    { label: "due date", value: "June 1, 2026" },
    { label: "account number", value: "AC-40192" },
  ],
  forbiddenPatterns: [{ label: "invented citation", pattern: "\\u00A7|\\bsection\\s+\\d" }],
  extract: { money: true, dates: true, percentages: true, patterns: [{ label: "account number", pattern: "AC-\\d{5}" }] },
};

export const cleanCandidate =
  "Dear Jane Roe, your account AC-40192 shows a balance of $1,500.00, due by June 1, 2026. Thank you.";

export const fabricatingCandidate =
  "Dear Jane Roe, your account AC-40192 shows a balance of $1,500.00, plus a $250.00 late fee, due by July 15, 2026. Per section 12 you must pay.";
```

- [ ] **Step 2: Create `apps/web/app/page.tsx`**

A client component: two text areas (candidate, source-of-truth JSON), a Verify button, a verdict banner, a violations list, the receipt JSON with a download, and a re-verify panel that checks the receipt client-side via the published public key. Client-side verification uses WebCrypto Ed25519 so it does not depend on `node:crypto`.

```tsx
"use client";

import { useState } from "react";
import { canonicalizeJson, type ProofReceipt } from "@groundlock/core";
import { exampleSource, cleanCandidate, fabricatingCandidate } from "@/lib/examples";

interface VerifyResponse {
  result: { verdict: "pass" | "block"; violations: { code: string; label: string; detail?: string }[] };
  receipt: ProofReceipt;
  publicKeyJwk: JsonWebKey;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function reverifyReceipt(receipt: ProofReceipt, publicKeyJwk: JsonWebKey): Promise<boolean> {
  try {
    const { signature, ...base } = receipt;
    const key = await crypto.subtle.importKey("jwk", publicKeyJwk, { name: "Ed25519" }, false, ["verify"]);
    const data = new TextEncoder().encode(canonicalizeJson(base));
    return await crypto.subtle.verify({ name: "Ed25519" }, key, b64urlToBytes(signature.sig), data);
  } catch {
    return false; // fail-closed
  }
}

export default function Home() {
  const [candidate, setCandidate] = useState(cleanCandidate);
  const [sourceText, setSourceText] = useState(JSON.stringify(exampleSource, null, 2));
  const [resp, setResp] = useState<VerifyResponse | null>(null);
  const [reverified, setReverified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onVerify() {
    setError(null);
    setReverified(null);
    setResp(null);
    let sourceOfTruth: unknown;
    try {
      sourceOfTruth = JSON.parse(sourceText);
    } catch {
      setError("Source of truth is not valid JSON.");
      return;
    }
    const r = await fetch("/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidate, sourceOfTruth }),
    });
    if (!r.ok) {
      setError("Verify request failed.");
      return;
    }
    const data = (await r.json()) as VerifyResponse;
    setResp(data);
    setReverified(await reverifyReceipt(data.receipt, data.publicKeyJwk));
  }

  const verdict = resp?.result.verdict;

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">GroundLock</h1>
        <p className="text-neutral-600">
          The AI cannot send a fabricated number, date, or registered identifier. Verify a draft against a source of
          truth and get a signed, re-verifiable proof.
        </p>
      </header>

      <div className="flex gap-2">
        <button className="rounded bg-neutral-200 px-3 py-1 text-sm" onClick={() => setCandidate(cleanCandidate)}>
          Load clean example
        </button>
        <button className="rounded bg-neutral-200 px-3 py-1 text-sm" onClick={() => setCandidate(fabricatingCandidate)}>
          Load fabricating example
        </button>
      </div>

      <label className="block">
        <span className="text-sm font-medium">AI-drafted message</span>
        <textarea
          className="mt-1 h-32 w-full rounded border p-2 font-mono text-sm"
          value={candidate}
          onChange={(e) => setCandidate(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Source of truth (JSON)</span>
        <textarea
          className="mt-1 h-56 w-full rounded border p-2 font-mono text-xs"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
        />
      </label>

      <button className="rounded bg-neutral-900 px-4 py-2 font-medium text-white" onClick={onVerify}>
        Verify
      </button>

      {error && <p className="text-red-600">{error}</p>}

      {resp && (
        <section className="space-y-4">
          <div
            className={
              "rounded p-3 font-semibold " +
              (verdict === "pass" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")
            }
          >
            {verdict === "pass" ? "PASS - every fact traced to the source of truth" : "BLOCK - fabricated or missing facts"}
          </div>

          {resp.result.violations.length > 0 && (
            <ul className="list-disc space-y-1 pl-6 text-sm">
              {resp.result.violations.map((v, i) => (
                <li key={i}>
                  <span className="font-mono">{v.code}</span> [{v.label}]
                  {v.detail ? <span className="text-neutral-600"> - {v.detail}</span> : null}
                </li>
              ))}
            </ul>
          )}

          <div className="rounded border p-3 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">Signed proof receipt</span>
              <span className={reverified ? "text-green-700" : "text-red-700"}>
                {reverified === null ? "" : reverified ? "signature re-verified in your browser" : "signature INVALID"}
              </span>
            </div>
            <pre className="max-h-64 overflow-auto bg-neutral-100 p-2 text-xs">
              {JSON.stringify(resp.receipt, null, 2)}
            </pre>
            <a
              className="mt-2 inline-block text-blue-700 underline"
              href={"data:application/json," + encodeURIComponent(JSON.stringify(resp.receipt, null, 2))}
              download="groundlock-receipt.json"
            >
              Download receipt
            </a>
          </div>

          <p className="text-xs text-neutral-500">
            This receipt proves the message bytes, the verdict, and the source-of-truth version were signed by the issuer
            and have not changed. It does not prove the time of issuance or the semantic correctness of any prose claim.
          </p>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Run the app and verify the demo by hand**

Run: `npm run dev --workspace @groundlock/web`
Then open `http://localhost:3000`.

Manual checks (the acceptance demo):
1. With the clean example loaded, click Verify. Expected: green PASS banner; receipt shows `"verdict": "pass"`; "signature re-verified in your browser" appears.
2. Click "Load fabricating example", then Verify. Expected: red BLOCK banner; violations list includes a `fabricated_fact` for the `$250.00` late fee, a `fabricated_fact` for the `July 15, 2026` date, and a `forbidden_match` for the `section 12` citation; the receipt `verdict` is `block` and still re-verifies (a signed BLOCK is still a valid receipt).
3. Edit the downloaded receipt's `verdict` by hand, paste it back into a quick check, or tamper any field and confirm re-verification would fail (covered by the unit test in Task 7; the UI re-verifies the server-issued receipt only).

Note for the implementer: if `crypto.subtle` Ed25519 is unavailable in the target browser, the re-verify line will read "signature INVALID"; the server-side guarantee is unaffected. Confirm on a current Chromium or Firefox.

- [ ] **Step 4: Typecheck the app**

Run: `npm run typecheck --workspace @groundlock/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/examples.ts apps/web/app/page.tsx
git commit -m "feat(web): add playground with examples and client-side receipt re-verification"
```

---

## Task 13: Project docs and final verification

**Files:**
- Create: `README.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# GroundLock

A vendor-neutral non-fabrication guarantee for AI-generated business messages. Submit an AI draft plus a structured source of truth; GroundLock returns PASS or BLOCK plus a signed, re-verifiable proof receipt. Every money amount, date, percentage, and registered identifier in the message must trace verbatim to the source of truth, or the message is blocked.

## What it proves and does not prove
- Proves: the message contains no fabricated operational facts (money, dates, percentages, registered patterns), required facts are present, and forbidden patterns (such as invented citations) are absent. The receipt is signed (Ed25519) and re-verifiable by anyone with the public key.
- Does not prove (v1): time of issuance (no trusted timestamp yet), or the semantic correctness of a prose claim that contains no extractable token.

## Layout
- `packages/core` - zero-dependency engine (canonicalize, extract, verify, ruleset, keys, receipt, guarantee).
- `apps/web` - Next.js playground and `/api/verify`.

## Develop
- `npm install`
- `npm test` - run the core test suite
- `npm run dev --workspace @groundlock/web` - run the playground at http://localhost:3000

## Status
v1 demo engine. No industry vertical committed. Fail-closed by design.
```

- [ ] **Step 2: Create `CLAUDE.md`**

```markdown
# GroundLock - project notes for Claude

GroundLock is a vendor-neutral non-fabrication guarantee for AI-generated business messages. The moat is the deterministic positive-entailment check (every operational token must trace to an allowed fact, or block), which no incumbent ships.

## Hard rules
- Fail-closed everywhere: any error, ambiguity, or unverifiable receipt is a BLOCK, never a silent PASS.
- Extraction over-blocks rather than under-blocks.
- Never let the engine claim semantic understanding or a trusted timestamp it does not have. Receipt copy must stay honest.
- `packages/core` stays zero-runtime-dependency (node:crypto and Intl only). Do not add deps to it.
- ASCII-only source on Windows (write Unicode as \\u escapes).

## Commands
- Test core: `npm test`
- Typecheck all: `npm run typecheck`
- Run demo: `npm run dev --workspace @groundlock/web`

## Roadmap (documented non-goals for v1)
- RFC 3161 trusted timestamp or transparency-log anchoring for receipts.
- Remote key resolution via `jwks_uri` in `verifyReceipt`.
- A reviewed source-of-truth library for a specific chosen vertical (decided after customer discovery).
```

- [ ] **Step 3: Full repo verification**

Run: `npm run test --workspace @groundlock/core`
Expected: PASS (all suites).

Run: `npm run typecheck`
Expected: PASS for both workspaces.

Run: `npm run build --workspace @groundlock/web`
Expected: Next build completes without type or compile errors.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: add README and project CLAUDE.md"
```

---

## Self-review notes (author checklist, already applied)

- Spec coverage: canonicalize/NFC (Task 2), operational-token extraction (Task 3), three-check verifier including the net-new positive-entailment and the swap-guard and word-boundary cases (Task 4), ruleset version hash (Task 5), Ed25519 keys (Task 6), signed re-verifiable receipt with detail stripped for privacy and fail-closed verification (Task 7), fail-safe generate orchestrator (Task 8), web playground + API + client re-verification + honesty copy + neutral example (Tasks 10-12), docs and non-goals (Task 13). Honesty guardrails (fail-closed, over-block, honest receipt copy) are encoded in Task 4, Task 7, and the UI copy in Task 12.
- Placeholder scan: every code and test step contains complete code; no TBD/TODO.
- Type consistency: `SourceOfTruth`, `Violation`, `VerifyResult`, `ProofReceipt`, `SigningKey` are defined once in Task 1 and used unchanged in Tasks 4, 5, 7, 8, 11; `issueReceipt` takes `issuedAt` in both its definition (Task 7) and call site (Task 11); `verify`, `hashSourceOfTruth`, `generateSigningKey`, `issueReceipt`, `verifyReceipt` signatures match between definition, barrel (Task 9), and consumers.
- Known deliberate deviation from the spec interface: `issueReceipt` takes an explicit `issuedAt: string` (the spec elided it) so the function is pure and deterministic for tests; the API route supplies the timestamp. `verifyReceipt` implements only the `JsonWebKey` path; `jwks_uri` is a documented v2 non-goal.
```
