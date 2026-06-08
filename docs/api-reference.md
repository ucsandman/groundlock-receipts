# API reference

## `GET /api/health`

Config-only health check for hosts and uptime monitors.

It returns `200` in demo mode. In live verifier mode, it returns `503` when `GROUNDLOCK_SIGNER_DOMAIN` is configured but `GROUNDLOCK_STATUS_BASE_URL` or `GROUNDLOCK_DOH_ENDPOINT` is missing, malformed, not HTTPS, credentialed, query/fragment-suffixed, malformed as a DNS host, or IP-based. If `NEXT_PUBLIC_SITE_URL` is set, it must also be a valid launch HTTPS URL. If `GROUNDLOCK_STATUS_BASE_URL` points at the same origin as `NEXT_PUBLIC_SITE_URL`, it also returns `503` until `GROUNDLOCK_STATUS_RECORDS_JSON` is parseable, every entry is a valid status record, and the bundle contains an active key record for the configured signer domain plus at least one active `sha256:` claim record for the bundled status routes. It reports booleans only and does not expose configured domain, resolver, status URL, or status record values.

```json
{
  "service": "groundlock-web",
  "ok": true,
  "mode": "live",
  "checks": {
    "signerDomainConfigured": true,
    "siteUrlConfigured": true,
    "dohEndpointConfigured": true,
    "statusBaseUrlConfigured": true,
    "statusRecordsConfigured": true
  }
}
```

This endpoint does not prove DNS cache chunks are warmed or that any receipt can verify. Use `groundlock check-live` for the public receipt path.

## `POST /api/verify`

Public, account-free verifier for GroundLock-canonicalized text content or `sha256:` hashes.

The verifier reconstructs the signed receipt from DNS resolver-cache TXT manifest/chunk records, then checks receipt hashes, signatures, grounding verdict, and status.

If `GROUNDLOCK_SIGNER_DOMAIN` is configured, `/api/verify` uses live DNS-over-HTTPS lookups and HTTP status endpoints. Missing, malformed, non-HTTPS, credentialed, query/fragment-suffixed, malformed-DNS-host, or IP-based `GROUNDLOCK_DOH_ENDPOINT` or `GROUNDLOCK_STATUS_BASE_URL` returns `UNVERIFIABLE` instead of falling back to demo fixtures, an implicit resolver, or a server error. Without `GROUNDLOCK_SIGNER_DOMAIN`, it uses local demo fixtures.

The web app also exposes optional public status routes at `/groundlock/status/key` and `/groundlock/status/claim` when `GROUNDLOCK_STATUS_RECORDS_JSON` is configured.

### Request

Use `Content-Type: application/json` and send a JSON object with exactly one public verification input.

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
- Rate limit: defaults to 240 public verifier requests per 60 seconds per app instance.
- Live DoH/status fetch timeout: defaults to 5000 ms per external request, configurable with `GROUNDLOCK_FETCH_TIMEOUT_MS` from 1 through 30000.
- JSON responses use `Cache-Control: no-store`.
- Remote URL fetching is not supported by the public endpoint.
- Publisher signing is not supported by the public endpoint.
- Non-JSON requests return HTTP `415` with `code: "unsupported_content_type"`.
- Malformed JSON returns HTTP `400` with `code: "invalid_json"`.
- Valid JSON that is not an object returns HTTP `400` with `code: "invalid_input"`.
- Unknown, malformed, missing, or oversized input fails closed.

The verifier uses one in-memory public bucket by default because spoofable forwarding headers are not trusted as client identity. Tune `GROUNDLOCK_RATE_LIMIT_MAX` and `GROUNDLOCK_RATE_LIMIT_WINDOW_MS` at the deployment edge for launch traffic. A limited response returns HTTP `429` with `Retry-After`.

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
  "whatItProves": "The verifier reconstructs a signed GroundLock receipt from DNS resolver-cache TXT chunks, then verifies the content hash, receipt hash, signature, grounding verdict, and revocation status.",
  "whatItDoesNotProve": "It does not prove the prose is true, that unmatched prose is complete, that issuance time is independently timestamped, or that resolver caches will retain every chunk.",
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
  "whatItProves": "The verifier reconstructs a signed GroundLock receipt from DNS resolver-cache TXT chunks, then verifies the content hash, receipt hash, signature, grounding verdict, and revocation status.",
  "whatItDoesNotProve": "It does not prove the prose is true, that unmatched prose is complete, that issuance time is independently timestamped, or that resolver caches will retain every chunk.",
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
  "whatItProves": "The verifier reconstructs a signed GroundLock receipt from DNS resolver-cache TXT chunks, then verifies the content hash, receipt hash, signature, grounding verdict, and revocation status.",
  "whatItDoesNotProve": "It does not prove the prose is true, that unmatched prose is complete, that issuance time is independently timestamped, or that resolver caches will retain every chunk.",
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
  "whatItProves": "The verifier reconstructs a signed GroundLock receipt from DNS resolver-cache TXT chunks, then verifies the content hash, receipt hash, signature, grounding verdict, and revocation status.",
  "whatItDoesNotProve": "It does not prove the prose is true, that unmatched prose is complete, that issuance time is independently timestamped, or that resolver caches will retain every chunk.",
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
