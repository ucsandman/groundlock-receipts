# API reference

## `POST /api/verify`

Public, account-free verifier for GroundLock-canonicalized text content or `sha256:` hashes.

The verifier reconstructs the signed receipt from DNS resolver-cache TXT manifest/chunk records, then checks receipt hashes, signatures, grounding verdict, and status.

### Request

Send exactly one of:

```json
{ "fileText": "Dear Jane Roe, your account AC-40192 shows a balance of $1,500.00, due by June 1, 2026. Thank you." }
```

```json
{ "hash": "sha256:wcOEI6HWksnG9nJNekJjb88DbtUTdSr-qyrjbHPZIcw" }
```

Remote URL verification is intentionally rejected:

```json
{ "url": "https://example.com/message.txt" }
```

### Limits

- `fileText` maximum: 256 KiB.
- Rate limit: 20 public verifier requests per 60 seconds in the demo bucket.
- Remote URL fetching is not supported by the public endpoint.
- Publisher signing is not supported by the public endpoint.
- Unknown, malformed, missing, or oversized input fails closed.

### Response shape

```ts
interface PublicVerifyResponse {
  state: "PASS" | "BLOCK" | "UNVERIFIABLE" | "REVOKED";
  code: string;
  explanation: string;
  whatItProves: string;
  whatItDoesNotProve: string;
  receiptSummary: null | {
    signerDomain: string;
    signerKeyId: string;
    contentClass: string;
    issuedAt: string;
    verdict: "pass" | "block";
    contentHash: string;
    receiptHash: string;
  };
  timingMs: number;
}
```

### PASS example

```json
{
  "state": "PASS",
  "code": "verified",
  "explanation": "DNS cache receipt verified",
  "whatItProves": "This demo reconstructs a signed GroundLock receipt from simulated DNS resolver-cache TXT chunks, then verifies the content hash, receipt hash, signature, grounding verdict, and revocation status.",
  "whatItDoesNotProve": "It does not prove the prose is true, that unmatched prose is complete, that issuance time is independently timestamped, or that live production DNS cache warming is configured.",
  "receiptSummary": {
    "signerDomain": "publisher.example",
    "signerKeyId": "demo-key-1",
    "contentClass": "demo-message",
    "issuedAt": "2026-06-08T12:00:00.000Z",
    "verdict": "pass",
    "contentHash": "sha256:...",
    "receiptHash": "sha256:..."
  },
  "timingMs": 1
}
```

### BLOCK example

```json
{
  "state": "BLOCK",
  "code": "receipt_blocked",
  "explanation": "receipt verdict is block",
  "whatItProves": "This demo reconstructs a signed GroundLock receipt from simulated DNS resolver-cache TXT chunks, then verifies the content hash, receipt hash, signature, grounding verdict, and revocation status.",
  "whatItDoesNotProve": "It does not prove the prose is true, that unmatched prose is complete, that issuance time is independently timestamped, or that live production DNS cache warming is configured.",
  "receiptSummary": {
    "signerDomain": "publisher.example",
    "signerKeyId": "demo-key-1",
    "contentClass": "demo-message",
    "issuedAt": "2026-06-08T12:00:00.000Z",
    "verdict": "block",
    "contentHash": "sha256:...",
    "receiptHash": "sha256:..."
  },
  "timingMs": 1
}
```

### UNVERIFIABLE example

```json
{
  "state": "UNVERIFIABLE",
  "code": "dns_txt_missing",
  "explanation": "No TXT record found for gl-unknownhashvalue._groundlock.publisher.example",
  "whatItProves": "This demo reconstructs a signed GroundLock receipt from simulated DNS resolver-cache TXT chunks, then verifies the content hash, receipt hash, signature, grounding verdict, and revocation status.",
  "whatItDoesNotProve": "It does not prove the prose is true, that unmatched prose is complete, that issuance time is independently timestamped, or that live production DNS cache warming is configured.",
  "receiptSummary": null,
  "timingMs": 0
}
```

### REVOKED example

```json
{
  "state": "REVOKED",
  "code": "status_revoked",
  "explanation": "claim_status_revoked: demo revocation",
  "whatItProves": "This demo reconstructs a signed GroundLock receipt from simulated DNS resolver-cache TXT chunks, then verifies the content hash, receipt hash, signature, grounding verdict, and revocation status.",
  "whatItDoesNotProve": "It does not prove the prose is true, that unmatched prose is complete, that issuance time is independently timestamped, or that live production DNS cache warming is configured.",
  "receiptSummary": {
    "signerDomain": "publisher.example",
    "signerKeyId": "demo-key-1",
    "contentClass": "demo-message",
    "issuedAt": "2026-06-08T12:00:00.000Z",
    "verdict": "pass",
    "contentHash": "sha256:...",
    "receiptHash": "sha256:..."
  },
  "timingMs": 1
}
```

### Unsupported publisher signing

The public verifier does not issue receipts. A caller that sends publisher inputs receives a fail-closed error:

```json
{
  "candidate": "Dear Jane Roe, return $2,000.00.",
  "sourceOfTruth": {
    "requiredFacts": [{ "label": "tenant", "value": "Jane Roe" }],
    "allowedFacts": [{ "label": "amount", "value": "$2,000.00" }]
  }
}
```

```json
{
  "state": "UNVERIFIABLE",
  "code": "public_signing_not_supported",
  "explanation": "The verification request could not be evaluated.",
  "whatItProves": "...",
  "whatItDoesNotProve": "...",
  "receiptSummary": null,
  "timingMs": 0
}
```

Use the publisher CLI or a separately authenticated publisher service to issue receipts.
