# GroundLock v1 — Design Spec

Date: 2026-06-01
Status: approved design, pre-implementation
Author: Wes + Claude

## 1. What this is

GroundLock is a vendor-neutral non-fabrication guarantee for AI-generated business communications. You submit an AI-drafted message plus a structured source of truth (the facts the message is allowed to assert), and GroundLock returns PASS or BLOCK plus a signed, re-verifiable proof receipt. The promise: every number, date, percentage, and registered pattern in the message must trace verbatim to the source of truth, or the message is blocked.

This is the one capability that survived an 18-test adversarial market hunt without being refuted: a hard, deterministic non-fabrication check, as opposed to the probabilistic monitoring (Sedric, Langfuse), generic policy gating (Microsoft AGT, NVIDIA OpenShell), or citation-only verification (Counsel Stack, CiteSentinel) that the market already sells.

v1 is a demoable, vendor-neutral engine. No industry vertical is committed. The build exists to make the guarantee tangible for customer-discovery conversations and to be the integratable core a first design partner could adopt.

## 2. Goals and non-goals

### Goals
- A pure, zero-dependency core engine that verifies a candidate message against a source of truth and returns a structured verdict.
- The positive-entailment check (no fabricated operational facts), which is the net-new capability not present in any source asset or named competitor.
- A signed, independently re-verifiable proof receipt (closing the unsigned-export overclaim found in the source assets).
- A minimal web playground plus a tiny HTTP API that demonstrate PASS, BLOCK, and receipt re-verification.
- Ported conformance tests that preserve the hard-won guarantees of the source code (swap-guard, invented-citation block, determinism, NFC normalization).

### Non-goals (v1)
- No industry vertical rule or fact library. The engine is content-neutral; the demo uses a neutral business-comms example.
- No RFC 3161 trusted timestamp and no transparency-log anchoring. v1 `issuedAt` is self-asserted and the receipt copy will say so. This is documented v2 work.
- No semantic or NLP entailment. Extraction is high-precision operational tokens only (money, dates, percentages, customer-registered patterns). The engine does not claim to understand meaning or to catch a fabricated prose claim that contains no extractable token.
- No auth, billing, multi-tenant persistence, or accounts beyond what the demo needs.
- No generation of the source of truth. The customer supplies it. (An optional generate-with-grounding mode is a thin wrapper, see 6.4.)

## 3. Honesty guardrails (non-negotiable)

These exist because the market hunt repeatedly killed products that overclaimed. They are requirements, not nice-to-haves.

1. Fail-closed everywhere. Any internal error, ambiguous input, or unverifiable receipt results in BLOCK, never a silent PASS. This deliberately inverts DashClaw's fail-soft JWKS policy.
2. Extraction over-blocks rather than under-blocks. A token the engine cannot trace is treated as a fabrication (BLOCK), not waved through.
3. Substring matching is honest about itself. The verifier checks verbatim survival, not meaning. A reworded-but-accurate restatement of a long required fact will block (safe direction). The deterministic path carries the exact operative strings.
4. Receipt copy states exactly what it proves (integrity of the message bytes, the signature, the verdict, the source-of-truth version) and what it does not prove (existence-at-a-time, semantic correctness, authorship by anyone but the issuer). No "tamper-evident against the issuer" or "court-ready timestamp" language in v1.

## 4. What is reused, and from where (verified against source)

The core is assembled from four existing, tested assets in the monorepo. The asset map was produced by reading the actual source.

- letter-cannon (`src/lib/grounding.ts`, `sanitize.ts`, `template.ts`, `generator.ts`): the verifier loop (canonicalize both sides, verbatim substring with structural role-slots so two same-typed values cannot swap), the fail-safe orchestration (build deterministic, optionally refine, re-verify, fall back), and the citation-signal negative assertion. Core is zero-dependency.
- CB Orange (`src/compliance/send-guardrails.ts`, `sending/governor.ts`, `approvals/approvals.ts`, `knowledge/pack.ts`): the word-boundary deny-list matching, the composed first-failure-wins gate, the content-hashed versioned ruleset (sha256 of canonical JSON to a version id), and the TOCTOU-safe persistence pattern (kept as a reference for a future persisted mode; v1 is stateless).
- moveout-witness (`src/lib/hash.ts`, `pdf.ts`, `dates.ts`): the `sha256Hex` seal (NIST-vector tested), the determinism levers (pinned dates, UTC formatting, sorted collections, no wall-clock or random in hashed bytes).
- DashClaw (`app/lib/act-binding.js`, `canonical-json.js`, `jwks-verifier.js`, `sdk/legacy/dashclaw-v1.js`): the canonical-hash engine (sorted keys, NFC normalize, `sha256:` + base64url framing), the WebCrypto sign and JWKS verify primitives, and the multi-alg verifier core.

Three corrections applied during the lift (all flagged by the asset map):
- Standardize on NFC normalization everywhere and base64url everywhere (DashClaw was inconsistent across its two canonicalizers and signature encodings).
- Invert fail-soft to fail-closed in the verifier path.
- Use Ed25519 rather than DashClaw's RSASSA-PKCS1-v1_5 (which was also cosmetically mislabeled as RSA-PSS in its keygen).

The single net-new capability not present in any source: the positive-entailment check (section 6.2). letter-cannon and CB Orange both enforce only "required facts present" and "forbidden tokens absent"; neither verifies that every operational token in the output traces to an allowed fact.

## 5. Architecture

Approach A: a monorepo with a zero-dependency core package and a Next.js app on top.

```
groundlock/
  packages/core/      @groundlock/core (zero runtime deps; node:crypto only) + vitest suite
    src/
      canonicalize.ts  NFC + dash/quote hygiene + deterministic JSON serializer + sha256 digest
      verify.ts        the three-check verifier -> { verdict, violations }
      extract.ts       operational-token extraction (money, dates, percentages, registered patterns)
      receipt.ts       issueReceipt (Ed25519 sign) + verifyReceipt (fail-closed)
      ruleset.ts       SourceOfTruth hashing -> version id (from CB Orange pack pattern)
      guarantee.ts     optional generate-with-grounding orchestrator (thin wrapper)
      keys.ts          Ed25519 keygen + JWK import/export helpers
      types.ts         SourceOfTruth, Violation, VerifyResult, ProofReceipt
      index.ts
    tests/             ported conformance suites (see section 9)
  apps/web/           Next.js 15 + Tailwind
    app/
      api/verify/route.ts   POST { candidate, sourceOfTruth } -> { verdict, violations, receipt }
      page.tsx              playground: editor + verdict + highlighted offending token + receipt download
      verify-receipt/...    client-side receipt re-verification panel (uses published public key)
    lib/examples.ts    seeded neutral business-comms example (PASS and BLOCK)
  README.md  CLAUDE.md  .env.example  .gitignore
```

The core package never imports from the app and has zero runtime dependencies (only `node:crypto` and standard `Intl`). It is the sellable, publishable asset. The app is the demo and the integration reference.

## 6. The engine

### 6.1 Required-fact check (no omission or alteration)
Every declared required fact must appear verbatim in the candidate after canonicalization. A fact may declare a structural role-slot (`prefix` and/or `suffix`) so the match must include the surrounding role words; this prevents two same-typed values (for example two dollar amounts) from swapping roles undetected. Empty facts are skipped. Lifted from `grounding.ts`.

Known limit carried over: if a value legitimately recurs elsewhere in the text, the in-context slot protection weakens. The engine documents this and recommends unique role-slots per ambiguous value.

### 6.2 Positive-entailment check (no fabrication) — the net-new capability
Extract every operational token from the candidate and require each to trace verbatim to an allowed fact; any untraceable token blocks.

Token classes extracted in v1 (high precision, honest scope):
- Money (currency-symbol amounts such as $1,500.00). Bare numbers without a currency symbol are out of v1 scope unless registered as a pattern, to avoid false positives on counts, years, and section numbers.
- Dates (multiple common formats, normalized to a canonical form before comparison).
- Percentages.
- Customer-registered patterns: regexes the source of truth declares (for example account-number shape, an invoice-id shape, or a citation format).

The check is deliberately not "extract every proper noun or claim." Names and arbitrary prose facts are covered only when declared as required facts (6.1) or registered patterns. This keeps the guarantee precise and honest: GroundLock blocks fabricated numbers, dates, percentages, and registered identifiers; it does not claim to catch a fabricated sentence with no extractable token.

Matching uses the same canonicalize-both-sides discipline as 6.1. Normalization is applied so that, for example, `$1,500.00` and `1500` and `$1,500` are compared on a normalized numeric form, and dates on a normalized date form, to avoid false fabrication flags on formatting differences while still blocking a genuinely different value.

### 6.3 Forbidden-pattern check (negative assertion)
Declared forbidden regexes (for example an invented-citation signal, or banned terms) must not match unless a fact authorizes them. Word-boundary matching from CB Orange to avoid false positives (the "Coopersville must not match Cooper" guarantee). The default pack ships a citation-signal pattern adapted from `grounding.ts` CITATION_SIGNAL.

### 6.4 Verdict and orchestration
`verify(candidate, source)` runs all three checks and returns `{ verdict: 'pass' | 'block', violations: Violation[] }`. Verdict is PASS iff all three pass. On any thrown error the result is BLOCK with an `engine_error` violation (fail-closed).

Optional generate mode `guarantee(...)`: given a deterministic template function and a pluggable `Refiner` (model adapter), build the deterministic draft, optionally refine, re-verify with `verify`, and on any violation or error return the deterministic text tagged `source: 'deterministic'`. Model output ships only when the verdict is PASS. This mirrors letter-cannon `generator.ts` and keeps GroundLock model-vendor-neutral. v1 ships the interface and a no-op/echo refiner; wiring a real model is not required for the demo.

## 7. Interfaces

```ts
interface RequiredFact { label: string; value: string; slot?: { prefix?: string; suffix?: string } }
interface AllowedFact  { label: string; value: string }
interface ForbiddenPattern { label: string; pattern: string; flags?: string }
interface RegisteredPattern { label: string; pattern: string }

interface SourceOfTruth {
  requiredFacts: RequiredFact[];
  allowedFacts: AllowedFact[];
  forbiddenPatterns?: ForbiddenPattern[];
  extract?: { money?: boolean; dates?: boolean; percentages?: boolean; patterns?: RegisteredPattern[] };
}

type ViolationCode = 'missing_required' | 'fabricated_fact' | 'forbidden_match' | 'engine_error';
interface Violation { code: ViolationCode; label: string; detail?: string }

interface VerifyResult { verdict: 'pass' | 'block'; violations: Violation[] }
function verify(candidate: string, source: SourceOfTruth): VerifyResult;

interface ProofReceipt {
  version: 'groundlock-receipt/v1';
  issuedAt: string;            // ISO 8601, self-asserted (v1)
  engineVersion: string;
  verdict: 'pass' | 'block';
  violations: Violation[];
  candidateHash: string;       // 'sha256:' + base64url(sha256(canonicalize(candidate)))
  sourceOfTruthHash: string;   // 'sha256:' + base64url over the canonicalized source (the ruleset version)
  signature: { alg: 'EdDSA'; kid: string; sig: string };  // over canonicalize(receipt without signature)
}

interface SigningKey { kid: string; privateKeyJwk: JsonWebKey }
function issueReceipt(result: VerifyResult, candidate: string, source: SourceOfTruth, key: SigningKey): ProofReceipt;
function verifyReceipt(receipt: ProofReceipt, publicKey: JsonWebKey | { jwks_uri: string }): { ok: boolean; reason?: string };
```

v1 implements only the direct `JsonWebKey` verification path (the playground publishes one public key). The `jwks_uri` overload is reserved for v2 remote-key resolution and is not built in v1.

Privacy property: the receipt stores hashes of the candidate and the source of truth, plus the verdict and violation labels. It does not embed raw fact values, so a receipt is shareable as proof without leaking the customer's data. (Violation `detail` strings must therefore avoid echoing raw secret values; they reference labels.)

## 8. Data flow (demo)

1. The playground page holds an editable candidate message and an editable source of truth, pre-seeded with a neutral account/billing example (balance, due date, account holder, account number) in two variants: one clean, one with a fabricated balance and an invented citation.
2. On Verify, the page POSTs `{ candidate, sourceOfTruth }` to `/api/verify`.
3. The route calls `verify`, then `issueReceipt` with the server signing key, and returns `{ verdict, violations, receipt }`.
4. The page renders PASS or BLOCK, highlights the exact offending token(s) from `violations`, and offers the signed receipt as a JSON download.
5. A separate panel lets the user paste a receipt and re-verify it client-side against the published public key, demonstrating independent re-verifiability and the fail-closed behavior on a tampered receipt.

## 9. Testing strategy

Vitest. The following guarantees are ported verbatim in spirit from the source suites and are the acceptance bar for the engine:

- Required-fact: PASS on a clean candidate; BLOCK when a required value is dropped or altered; BLOCK on the amount-swap case (the structural-slot regression); BLOCK on a reworded long required fact (documents the safe over-block direction).
- Positive-entailment (net-new, must be authored): BLOCK when the candidate contains a money value, date, percentage, or registered-pattern token not present in allowedFacts; PASS when every extracted token traces; PASS across formatting variants of the same value ($1,500.00 vs 1500); BLOCK on an equal-but-different value.
- Forbidden-pattern: BLOCK on an invented citation when none is authorized; the word-boundary false-positive cases (Cooper / Coopersville, FREE / Freedom Field) must not false-trip.
- Canonicalize: idempotent; digit-hyphen preserved (statute-style numbers not mangled); smart quotes/dashes/ellipsis normalized; NFC equivalence (precomposed and decomposed Unicode produce the same digest); key-order-independent canonical JSON.
- Receipt: signing then verifying round-trips to ok; a tampered candidateHash, sourceOfTruthHash, verdict, or signature yields ok=false; the digest matches the documented recipe; fail-closed on malformed receipts.
- Determinism: hashing the same canonical input twice yields identical digests; SHA-256 pinned to NIST vectors.

Verification commands (per repo convention): `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build`. The engine path runs fully offline with no env keys.

## 10. Tech decisions (locked)

- Language: TypeScript, strict. Monorepo via npm workspaces (approach A; no extra package-manager install needed).
- Core package: zero runtime dependencies (`node:crypto`, `Intl`, WebCrypto). Vitest for tests.
- Signature: Ed25519 (EdDSA, OKP), native `node:crypto`. JWKS-style publication of the public key for third-party verification.
- Canonicalization: NFC everywhere, sorted keys, no whitespace, base64url everywhere, `sha256:` digest framing.
- Web: Next.js 15 App Router + Tailwind (repo convention). One API route, one playground page, one receipt-verify panel.
- Location: new standalone `C:\Projects\groundlock`. New-project hygiene: `.env.example`, `.gitignore`, `README.md`, `CLAUDE.md`. GitHub account ucsandman if and when pushed.

## 11. Risks and open questions

- Extraction precision is the core engineering risk. Money and date parsing across formats is fiddly; the mitigation is the fail-closed, over-block stance plus a strong test matrix. If extraction proves too noisy on real drafts, the honest fallback is to narrow the default token classes and lean more on declared required facts and registered patterns.
- The positive-entailment check can be defeated by a fabricated prose claim with no extractable token. This is a stated non-goal for v1 and must be disclosed in the receipt copy and the README.
- The signed receipt proves integrity and issuer signature, not existence-at-a-time. v2 adds RFC 3161 or a transparency log. v1 copy must not overclaim.
- The product is, by nature, a feature a platform could absorb. The durable edge is being first and narrow with a specific reviewed source-of-truth for one buyer's workflow. That is a go-to-market step (the 10 discovery conversations), not part of this build.
```
