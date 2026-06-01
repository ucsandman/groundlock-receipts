# GroundLock

A vendor-neutral non-fabrication guarantee for AI-generated business messages. Submit an AI draft plus a structured source of truth; GroundLock returns PASS or BLOCK plus a signed, re-verifiable proof receipt. Every currency-formatted ($) amount, date, percentage, and registered-pattern token in the message must trace verbatim to the source of truth, or the message is blocked.

## What it proves and does not prove
- Proves: the message contains no fabricated operational facts (currency-formatted amounts, dates, percentages, registered-pattern tokens), required facts are present, and forbidden patterns (such as invented citations) are absent. The receipt is signed (Ed25519) and re-verifiable by anyone with the public key.
- Does not prove (v1): time of issuance (no trusted timestamp yet), the semantic correctness of a prose claim that contains no extractable token, or the accuracy of a bare number written without a currency symbol (checked only when you register a pattern for it).

## Layout
- `packages/core` - zero-dependency engine (canonicalize, extract, verify, ruleset, keys, receipt, guarantee).
- `apps/web` - Next.js playground and `/api/verify`.

## Develop
- `npm install`
- `npm test` - run the core test suite
- `npm run dev --workspace @groundlock/web` - run the playground at http://localhost:3000

## Status
v1 demo engine. No industry vertical committed. Fail-closed by design.
