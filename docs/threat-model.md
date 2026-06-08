# Threat model

GroundLock Receipts are canonicalized-message accountability artifacts stored in DNS resolver caches. They are designed to fail closed and avoid broader claims the system cannot prove.

## What it proves

- The verifier checked one GroundLock canonicalized text hash.
- DNS TXT cache records contained a manifest and all required receipt chunks.
- The reconstructed DNS-cache payload hash matched the manifest.
- The reconstructed receipt hash matched the manifest.
- The receipt signature verified against the signer identity.
- The key and claim status records were active.
- The receipt verdict was PASS or BLOCK.

## What it does not prove

- It does not independently adjudicate truth.
- It does not prove all prose is complete.
- It does not prove semantic meaning beyond configured extracted tokens and required/allowed facts.
- It does not provide a trusted timestamp.
- It does not prove the publisher's source of truth was correct.
- It does not prevent a publisher from issuing a bad receipt with its own key.
- It does not guarantee that recursive resolver caches will retain data forever.

## Spam and phishing boundary

GroundLock can expose unsigned impersonation. If a message claims to be from `publisher.example`, verification can check
whether `publisher.example` anchored a receipt for that exact canonicalized message hash and whether the receipt/key are
still active.

GroundLock does not stop arbitrary spam, judge link safety, score sender reputation, or decide whether signed content is
good for the recipient. It is a provenance and integrity layer that spam filters, mail clients, browser extensions, and
AI agents can use as one signal.

## Canonicalized-hash limits

A receipt binds one GroundLock text-canonicalized content hash (`groundlock:text:nfc-v1`). The hash normalizes Unicode text and selected punctuation before hashing; it is not a raw byte-for-byte file identity claim.

Attachments, rendering differences, and file-format bytes are outside the public text verifier path and must be verified separately if a publisher needs raw file identity.

## DNS cache storage limits

GroundLock uses the DNSFS-style idea that recursive DNS resolver caches can temporarily hold TXT answers. This is an availability layer, not the trust layer.

The trust layer is:

- manifest payload hash
- reconstructed receipt hash
- Ed25519 receipt signature
- key and claim status records

If a resolver cache evicts a chunk, returns malformed data, returns conflicting records, or cannot be queried, the verifier returns UNVERIFIABLE.

GroundLock does not scan for random open resolvers. The intended v1 path is configured resolver targets, local fixtures, or consenting infrastructure.

## Attacker capabilities

GroundLock assumes attackers may:

- alter message text
- paste a stale or unrelated hash
- replay an old cached receipt
- publish malformed manifest or chunk records
- remove one or more DNS cache chunks
- poison or tamper with resolver answers
- compromise an old signer key
- block resolver access
- try to infer private workflow activity from public status lookups

GroundLock does not assume DNS caches will always be reachable or durable.

## Fail-closed states

PASS is available only when all required checks succeed.

BLOCK is available when a signed receipt verifies and the publisher's own receipt verdict is block.

REVOKED is available when the receipt or key status says revoked, retracted, or compromised.

UNVERIFIABLE is used for missing DNS, missing DNSSEC/validation evidence where required, malformed records, missing cache chunks, mismatched payload hashes, mismatched receipt hashes, invalid signatures, missing status records, unsupported input, rate limits, or payload limits.

## Key rotation

Signers should rotate keys by publishing a new identity record with a new key id and by publishing key status for old keys. If an old key is compromised, status should move to compromised or revoked.

Receipts signed by old active keys can still verify. Receipts signed by revoked or compromised keys must not PASS.

## Revocation

Receipt revocation is status-based, not signature-based. A revoked receipt can still have a valid Ed25519 signature, but the verifier must return REVOKED because the current status overrides the old claim.

Publishers should keep revocation status reachable for as long as receipts may be checked by counterparties.

In production web verifier mode, key and claim status are read from publisher-controlled HTTPS JSON endpoints. If those endpoints are missing, unreachable, malformed, or return the wrong subject, verification returns UNVERIFIABLE. The status endpoint is not a trusted timestamp authority.

## DNS cache records

DNS records store the receipt payload:

- identity record: signer key material
- manifest record: receipt hash, payload hash, chunk count, and key reference
- chunk records: base64url slices of the signed receipt payload

DNS cache storage does not make receipt content true. It only makes the signed receipt publicly reconstructable.

## C2PA interop

GroundLock sidecars target C2PA Technical Specification 2.4 as interop metadata. They are not official C2PA manifest stores, JUMBF boxes, embedded credentials, or C2PA claim signatures.

Use official C2PA tools for content credential signing and embedding. Use GroundLock DNS cache records for public receipt reconstruction and verification on top of the GroundLock receipt hash.

## Private workflow leakage

Public status lookup can reveal which receipt hash is being checked.

Private lookup helpers derive HMAC lookup keys so a publisher-controlled resolver can avoid broadcasting raw claim hashes. This reduces leakage but does not hide activity from the resolver operator, logs, or systems that see the original file/hash.

## Operational boundaries

- The CLI prints DNS cache records but does not mutate production DNS.
- The web verifier rejects remote URL fetching.
- The public web verifier does not issue signed receipts.
- Production publishers need stable signing keys outside the public verifier, configured resolver-cache warming, and reachable status records.
