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
