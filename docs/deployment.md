# Deployment

GroundLock has two web verifier modes:

- Demo mode: no environment variables. The app verifies built-in DNS-cache fixtures for local testing.
- Production verifier mode: `GROUNDLOCK_SIGNER_DOMAIN` is set. The app reconstructs receipts through DNS-over-HTTPS TXT lookups and checks key/claim status through HTTPS JSON endpoints.

The public verifier must not hold receipt-signing private keys.

## Environment

```text
GROUNDLOCK_SIGNER_DOMAIN=publisher.example
GROUNDLOCK_DOH_ENDPOINT=https://cloudflare-dns.com/dns-query
GROUNDLOCK_STATUS_BASE_URL=https://publisher.example/groundlock/status
```

`GROUNDLOCK_DOH_ENDPOINT` is optional and defaults to Cloudflare DoH. The DoH response must include the DNSSEC AD signal; otherwise the verifier fails closed with `dnssec_not_validated`.

`GROUNDLOCK_STATUS_BASE_URL` is required when `GROUNDLOCK_SIGNER_DOMAIN` is set.
The status base URL should be a publisher-controlled HTTPS origin. It is used only for public key and claim status; it is not a signing service and not a timestamp authority.

## Health check

Use `GET /api/health` for deployment readiness and uptime monitors. It returns booleans for whether live verifier environment variables are configured, but never returns configured domain, resolver, status URL, status records, or secrets.

In demo mode it returns `200`. In live mode it returns `503` when `GROUNDLOCK_SIGNER_DOMAIN` is set without the required `GROUNDLOCK_STATUS_BASE_URL`.

This is a deployment configuration check only. It does not prove resolver caches are warmed or that a receipt can verify; use `groundlock check-live` for that release gate.

## DNS TXT records

The publisher must serve and warm the records printed by the CLI:

```powershell
groundlock setup-domain .\receipt.json --public-key $publicJwk
```

Required TXT records:

- `_truename.<domain>` identity record
- `gl-<hash>._groundlock.<domain>` manifest record
- `c<N>.gl-<hash>._groundlock.<domain>` chunk records

After publishing, query the manifest and all chunks through the configured recursive resolver path before announcing the receipt. Verification returns `UNVERIFIABLE` if any cache chunk is missing, malformed, not DNSSEC validated, or hash-mismatched.

Use the CLI to verify the same public path the web verifier will use:

```powershell
groundlock check-live .\notice.txt --domain publisher.example --status-base-url https://publisher.example/groundlock/status --doh-endpoint https://cloudflare-dns.com/dns-query
```

Expected output:

```text
PASS verified - DNS cache receipt verified
```

## Status endpoints

The verifier calls two public HTTPS endpoints:

```text
GET <GROUNDLOCK_STATUS_BASE_URL>/key?lookup=key:<signer-domain>:<kid>
GET <GROUNDLOCK_STATUS_BASE_URL>/claim?lookup=claim:<receipt-hash>
```

The bundled web app can serve these endpoints at `/groundlock/status/key` and `/groundlock/status/claim` when `GROUNDLOCK_STATUS_RECORDS_JSON` is configured. For a same-origin deployment, set:

```text
GROUNDLOCK_STATUS_BASE_URL=https://publisher.example/groundlock/status
GROUNDLOCK_STATUS_RECORDS_JSON=[...public key and claim status records...]
```

Generate the full web env block from a local publish fixture:

```powershell
groundlock export-web-env .\published\dns-fixture.json --status-base-url https://publisher.example/groundlock/status --doh-endpoint https://cloudflare-dns.com/dns-query
```

Return the JSON status record directly:

```json
{
  "version": "groundlock-status/v1",
  "kind": "key",
  "subject": { "signerDomain": "publisher.example", "kid": "k1" },
  "status": "active",
  "issuedAt": "2026-06-08T00:00:00.000Z"
}
```

```json
{
  "version": "groundlock-status/v1",
  "kind": "claim",
  "subject": { "receiptHash": "sha256:..." },
  "status": "active",
  "issuedAt": "2026-06-08T00:00:00.000Z"
}
```

Use HTTP `404` for missing status records. Use `revoked`, `retracted`, or `compromised` status values to force `REVOKED`.

## Release checklist

- Public HTTPS verifier deployed.
- Web env generated with `groundlock export-web-env` and installed in the deployment.
- `GROUNDLOCK_SIGNER_DOMAIN` points at the publisher domain.
- `GROUNDLOCK_STATUS_BASE_URL` serves key and claim status JSON.
- `GET /api/health` returns `200` on the deployed verifier.
- DNS TXT identity, manifest, and chunk records are published.
- Configured resolvers are warmed and verified before links are shared.
- `groundlock check-live <file|hash> --domain <domain> --status-base-url <url>` returns PASS from the configured resolver path.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm audit --json` pass.
