# Architecture and data flow

GroundLock is built around the DNSFS idea: DNS resolver caches can temporarily hold data. GroundLock uses that mechanism for signed AI-message receipts, while the receipt signature and hashes provide integrity.

## Packages

### Core

`packages/core` is the zero-runtime-dependency verification engine. Runtime dependencies are limited to Node built-ins and standard JavaScript APIs.

Core modules:

- Canonicalization and hashing: stable JSON/text digests.
- Extraction: currency amounts, dates, percentages, and registered patterns.
- Verification: PASS/BLOCK trace generation.
- Receipts: signed rich receipt bodies and signature verification.
- Status: key and claim status records, public/private lookup keys, and status-aware receipt verification.
- DNS cache transport: TXT identity, manifest, and chunk formats; local/DoH resolver contracts; DNS-cache receipt reconstruction; PASS/BLOCK/UNVERIFIABLE/REVOKED state mapping.
- C2PA interop: deterministic JSON sidecar projection, not official C2PA embedding/signing.

### CLI

`packages/cli` is the publisher surface:

- `sign` writes a signed receipt for one file.
- `setup-domain` prints DNS cache TXT records for an existing receipt and never mutates DNS.
- `local-publish` writes local receipt/status/DNS-cache fixture artifacts for demos and tests.
- `verify` verifies a file or hash by reconstructing the receipt from a local DNS-cache fixture.
- `--c2pa-sidecar` emits a C2PA-compatible interop sidecar for a signed receipt.

### Web verifier

`apps/web` serves:

- Homepage and threat model page.
- `POST /api/verify` public verifier endpoint.
- Legacy demo candidate/source signing path.

The public verifier accepts `fileText` that is hashed with GroundLock text canonicalization or an already computed `sha256:` hash input. It rejects remote URLs, caps file input at 256 KiB, and rate-limits public requests.

## Data flow

1. Publisher generates or receives a candidate business message.
2. Core verifies extracted operational tokens against a structured source of truth.
3. Core issues a signed GroundLock receipt with:
   - canonicalized content hash
   - source hash
   - signer domain
   - signer key id
   - content class
   - grounded claim summaries
   - PASS or BLOCK verdict
4. Publisher encodes the full signed receipt as base64url payload text.
5. Publisher splits the payload into DNS TXT-sized chunks.
6. Publisher publishes or serves DNS TXT records:
   - identity record at `_truename.<domain>`
   - manifest record at the GroundLock content-hash name
   - chunk records at `c<N>.<content-hash-name>`
7. Publisher warms configured recursive DNS resolver caches by querying those records through the resolver set.
8. Publisher publishes status records:
   - key status
   - claim/receipt status
9. Public verifier hashes the pasted file or accepts the pasted hash.
10. Verifier resolves the DNS TXT manifest and chunks from the configured resolver path.
11. Verifier reconstructs the signed receipt from DNS cache chunks.
12. Verifier checks:
    - manifest shape
    - chunk count and chunk indexes
    - payload hash
    - identity signer key
    - receipt hash
    - receipt signature
    - key status
    - claim status
    - receipt verdict
13. UI returns PASS, BLOCK, REVOKED, or UNVERIFIABLE.

## DNS cache records

DNS is the storage and amplification layer for GroundLock receipt payloads. The verifier does not need an HTTPS receipt URL to reconstruct a receipt in the local demo path.

Identity TXT record:

```text
_truename.publisher.example TXT glt1 kid=<kid> alg=EdDSA jwk=<encoded-public-jwk>
```

Manifest TXT record:

```text
gl-<content-hash>._groundlock.publisher.example TXT gdm1 rh=<receipt-hash> ph=<payload-hash> n=<chunk-count> key=publisher.example#<kid>
```

Chunk TXT records:

```text
c0.gl-<content-hash>._groundlock.publisher.example TXT gdc1 i=0 d=<base64url-payload-slice>
c1.gl-<content-hash>._groundlock.publisher.example TXT gdc1 i=1 d=<base64url-payload-slice>
```

The CLI prints these records. It does not mutate production DNS. A production publisher still needs an authoritative DNS path or responder capable of serving these records long enough to warm the configured recursive resolvers.

## Cache warming

The local fixture simulates a warmed resolver cache by storing TXT answers in JSON. Production cache warming is a separate operational concern: query the manifest and chunk records through configured resolver targets, then verify the cache can reconstruct the receipt before announcing availability.

GroundLock does not scan the internet for open resolvers. The safer product path is configured or consenting resolvers first.

## Revocation and status

Status records are separate from receipt signatures:

- active key + active claim + valid PASS receipt -> PASS
- valid BLOCK receipt -> BLOCK
- revoked/compromised/retracted key or claim -> REVOKED
- missing/unreachable/malformed status -> UNVERIFIABLE

Old signatures can remain cryptographically valid while the public state is REVOKED.

## Privacy modes

Public lookup mode exposes the key or receipt hash being checked.

Private lookup helpers derive HMAC lookup keys from a secret and salt. They are intended for publisher-controlled workflows where status lookup should not broadcast every claim hash to a public resolver.

## C2PA interop

GroundLock does not compete with C2PA. Official C2PA tools should create and embed signed content credentials. GroundLock sidecars add an interop projection that points from a C2PA-style manifest shape to the GroundLock receipt hash, canonicalized content hash, and signer reference.

GroundLock DNS cache records then provide public reconstruction and verification for that receipt.
