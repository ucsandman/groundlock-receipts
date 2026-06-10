# GroundLock

GroundLock has been folded into DashClaw.

Its fail-closed verifier ships inside DashClaw at `app/lib/integrity/verify.ts`
(live endpoint `/api/integrity/verify` with JWKS).
See [github.com/ucsandman/DashClaw](https://github.com/ucsandman/DashClaw).

## What GroundLock proved

GroundLock demonstrated that deterministic, fail-closed grounding receipts are
viable for AI-generated business messages: every operational token in a message
(currency amounts, dates, percentages, registered patterns) must trace to an
allowed source fact or the receipt is BLOCK, never a silent PASS. The DNS-cache
split-receipt mechanism showed that a publisher can issue, chunk, and warm
signed receipts across resolver caches without requiring accounts or
centralized infrastructure. That core insight — and the positive-entailment
engine behind it — moved directly into DashClaw's integrity layer. The
canonicalization and extraction logic lives in
`app/lib/integrity/verify.ts`; the CLI signing tools were retired in favour
of DashClaw's API-key workflow; and the C2PA interop sidecar is preserved as
reference documentation in the DashClaw docs.

## Preservation note

This repository is preserved read-only for historical reference. No further
development will occur here.
