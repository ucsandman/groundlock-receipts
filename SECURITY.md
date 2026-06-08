# Security policy

GroundLock is a proof-of-concept receipt verifier. Treat `main` as the only supported version until tagged releases exist.

## Report a vulnerability

Use GitHub Security Advisories for private reports when available. If advisories are not available, open a GitHub issue with minimal detail and ask for a private handoff before posting exploit steps, private keys, customer data, or live resolver targets.

## Public verifier boundary

- The public web verifier must not issue signed receipts.
- Publisher signing keys must stay outside the public verifier deployment.
- Missing, malformed, revoked, or unverifiable receipt data must fail closed as `UNVERIFIABLE`, `REVOKED`, or `BLOCK`.
- Demo fixtures and local DNS-cache records must not contain real customer data or private keys.
