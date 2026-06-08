# Deployment

GroundLock has two web verifier modes:

- Demo mode: no environment variables. The app verifies built-in DNS-cache fixtures for local testing.
- Production verifier mode: `GROUNDLOCK_SIGNER_DOMAIN` is set. The app reconstructs receipts through DNS-over-HTTPS TXT lookups and checks key/claim status through HTTPS JSON endpoints.

The public verifier must not hold receipt-signing private keys.

## Environment

Copy `.env.example` only as a placeholder reference. Do not commit a real `.env` file.

```text
GROUNDLOCK_SIGNER_DOMAIN=publisher.example
NEXT_PUBLIC_SITE_URL=https://receipts.example.com
GROUNDLOCK_DOH_ENDPOINT=https://cloudflare-dns.com/dns-query
GROUNDLOCK_STATUS_BASE_URL=https://publisher.example/groundlock/status
GROUNDLOCK_RATE_LIMIT_MAX=240
GROUNDLOCK_RATE_LIMIT_WINDOW_MS=60000
```

Demo mode does not use live DoH. When `GROUNDLOCK_SIGNER_DOMAIN` is set, `GROUNDLOCK_DOH_ENDPOINT` is required and must be a valid HTTPS URL so the verifier does not silently fall back to an unintended resolver. `groundlock export-web-env`, `groundlock warm-cache`, and `groundlock check-live` reject malformed, non-HTTPS, credentialed, query-suffixed, fragment-suffixed, or IP-based launch URLs before making resolver or status requests. The Hacker News readiness audit requires the deployed verifier to report `dohEndpointConfigured` and requires `warm-cache`, `check-live`, and `hn_readiness.py` to use the same DoH endpoint URL. The DoH response must include the DNSSEC AD signal; otherwise the verifier fails closed with `dnssec_not_validated`.

`NEXT_PUBLIC_SITE_URL` should be the public HTTPS origin for the deployed verifier. It is used for canonical metadata, Open Graph images, `robots.txt`, and `sitemap.xml`. Set it before building static metadata; `robots.txt` and `sitemap.xml` also read it at runtime. If set in live mode, `/api/health` requires it to be a valid HTTPS URL.

`GROUNDLOCK_STATUS_BASE_URL` is required when `GROUNDLOCK_SIGNER_DOMAIN` is set.
The status base URL must be a valid publisher-controlled HTTPS URL. It is used only for public key and claim status; it is not a signing service and not a timestamp authority.

`GROUNDLOCK_RATE_LIMIT_MAX` and `GROUNDLOCK_RATE_LIMIT_WINDOW_MS` are optional. Defaults are `240` verifier requests per `60000` ms per app instance. The public verifier intentionally does not trust spoofable forwarding headers for client identity, so put stricter per-client throttling at a trusted edge proxy if needed.

## Container deployment

Build and run the public verifier container:

```powershell
docker build -t groundlock-web .
docker run --rm -p 3000:3000 groundlock-web
```

For live verifier mode, pass the generated environment block from `groundlock export-web-env --status-base-url <url> --doh-endpoint <url> --site-url <public verifier URL>` through your host's secret/env system. For local testing, write those values to an uncommitted `.env` file and run:

```powershell
docker run --rm --env-file .env -p 3000:3000 groundlock-web
```

The image runs `apps/web` with Next standalone output, listens on `PORT` or `3000`, runs as the non-root `node` user, and includes a Docker `HEALTHCHECK` against `/api/health`.

The web app sets browser hardening headers for all routes: `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `X-DNS-Prefetch-Control`, `X-Permitted-Cross-Domain-Policies`, and `Permissions-Policy`. The production header contract lives in `apps/web/lib/security-header-contract.json`.
CI runs `node scripts/smoke_web_response.mjs <base-url>` against the built Docker image to prove `/` and `/api/health` return 200, production security headers from that contract, and `Cache-Control: no-store` on health responses.

## Publisher key bootstrap

Generate a publisher signing keypair outside the public verifier deployment:

```powershell
groundlock generate-key launch-key-1 --out .\keys
```

The command writes `launch-key-1.private.jwk` and `launch-key-1.public.jwk` and prints only file paths. Keep the private JWK in the publisher signing workflow or managed key storage; do not put it in the web verifier, Docker image, DNS, `.env`, or Git. The public JWK is used for DNS identity records:

```powershell
groundlock local-publish .\notice.txt --source .\source.json --domain publisher.example --kid launch-key-1 --key .\keys\launch-key-1.private.jwk --public-key .\keys\launch-key-1.public.jwk --out .\published
```

## Health check

Use `GET /api/health` for deployment readiness and uptime monitors. It returns booleans for whether live verifier environment variables are configured, but never returns configured domain, resolver, status URL, status records, or secrets.

In demo mode it returns `200`. In live mode it returns `503` when `GROUNDLOCK_SIGNER_DOMAIN` is set without the required `GROUNDLOCK_STATUS_BASE_URL` or `GROUNDLOCK_DOH_ENDPOINT`, or when the configured site, DoH, or status URLs are malformed or not HTTPS.

If `GROUNDLOCK_STATUS_BASE_URL` points at the same origin as `NEXT_PUBLIC_SITE_URL`, health also requires `GROUNDLOCK_STATUS_RECORDS_JSON` to parse, contain only valid status records, and include at least one usable key record and one usable claim record; that means the deployment is using the bundled `/groundlock/status/key` and `/groundlock/status/claim` routes. Externally managed status endpoints are allowed without bundled status JSON, but `groundlock check-live` must still pass before launch.

This is a deployment configuration check only. It does not prove resolver caches are warmed or that a receipt can verify; use `groundlock check-live` and the deployed `/api/verify` launch audit for that release gate. Health, verify, and status JSON responses use `Cache-Control: no-store` so stale verifier state is not cached by default. The readiness audit also requires production browser hardening headers on deployed homepage and health responses so a platform or proxy cannot silently strip them before launch.

## DNS TXT records

The publisher must serve and warm the records printed by the CLI:

```powershell
groundlock setup-domain publisher.example --receipt .\receipt.json --public-key .\public.jwk
```

`setup-domain` prints DNS records only. It exits before any DNS mutation, so the publisher still needs to install those TXT records with its DNS provider or authoritative responder. For providers that accept zone-file style records, export pasteable FQDN TXT lines with an explicit TTL:

```powershell
groundlock setup-domain publisher.example --receipt .\receipt.json --public-key .\public.jwk --format zone --ttl 300
```

The zone-file output splits long TXT values into quoted 255-character strings on the same record line.

Required TXT records:

- `_truename.<domain>` identity record
- `gl-<hash>._groundlock.<domain>` manifest record
- `c<N>.gl-<hash>._groundlock.<domain>` chunk records

After publishing, query the manifest and all chunks through the configured recursive resolver path before announcing the receipt. Verification returns `UNVERIFIABLE` if any cache chunk is missing, malformed, not DNSSEC validated, or hash-mismatched.

Use the local publish fixture to warm and compare every expected TXT answer through the same DoH endpoint:

```powershell
groundlock warm-cache .\published\dns-fixture.json --doh-endpoint https://cloudflare-dns.com/dns-query
```

Expected output:

```text
PASS warmed <n> DNS TXT names
```

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

The bundled web app can serve these endpoints at `/groundlock/status/key` and `/groundlock/status/claim` when `GROUNDLOCK_STATUS_RECORDS_JSON` is configured. For a same-origin deployment, set both variables with a parseable bundle of valid key and claim records or `/api/health` returns `503`:

```text
GROUNDLOCK_STATUS_BASE_URL=https://publisher.example/groundlock/status
GROUNDLOCK_STATUS_RECORDS_JSON=[...public key and claim status records...]
```

Generate the full web env block from a local publish fixture:

```powershell
groundlock export-web-env .\published\dns-fixture.json --status-base-url https://publisher.example/groundlock/status --site-url https://receipts.example.com --doh-endpoint https://cloudflare-dns.com/dns-query
```

`--doh-endpoint` is required because the generated block enables live verifier mode, and live mode fails closed without an explicit resolver URL. `--site-url` is optional for local demos, but required for a public launch because the readiness audit expects the deployed verifier to report `siteUrlConfigured` and render canonical/share metadata for the public origin. If a path is provided, the CLI writes only the origin.

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

## Launch readiness audit

After the public verifier, DNS records, resolver cache warming, status endpoints, and CI are in place, run:

```powershell
python .\scripts\hn_readiness.py --health-url https://publisher.example --dns-fixture .\published\dns-fixture.json --file-or-hash sha256:<hash> --domain publisher.example --status-base-url https://publisher.example/groundlock/status --doh-endpoint https://cloudflare-dns.com/dns-query --evidence-out .\published\hn-readiness-evidence.json
```

`--health-url` must be the deployed verifier root URL or its exact `/api/health` URL. Nested app paths are rejected so the audit does not probe `<path>/api/health` or compare homepage metadata against the wrong launch URL.

`--dns-fixture` must be the fixture generated for the same launch domain and the same `--file-or-hash` demo input. The audit checks the fixture JSON before external requests and requires matching `domain`, a valid unambiguous identity TXT whose `kid` matches the manifest key, a valid unambiguous manifest TXT for the demo hash whose signer domain matches the launch domain, every valid unambiguous chunk TXT declared by the manifest `n=<count>`, reconstructed chunk payload that matches manifest `ph`, cached receipt JSON whose signer, candidate content hash, and body hash match the manifest, and valid active `groundlock-status/v1` key/claim status entries whose subjects match the manifest key and receipt hash.

`--evidence-out` is optional but recommended for launch. It writes a versioned JSON report containing the public launch inputs, current git head, security-header contract hash, and every PASS/FAIL check result. If the evidence file cannot be written, the audit exits non-zero.

The audit exits non-zero if:

- the git worktree is dirty
- `docs/show-hn-draft.md` still contains `LOCAL_DEMO_ONLY`
- the launch URLs are not public HTTPS URLs, include credentials/query/fragment suffixes, contain malformed DNS labels, use a nested health URL path, or the signer domain is still a placeholder/local host or IP address
- the local `dns-fixture.json` is missing, malformed, for a different domain, for a different demo hash, lacks identity, manifest, declared chunk, key status, or claim status entries, has malformed or ambiguous identity/manifest/chunk TXT records, has chunk payload that does not match manifest `ph`, has cached receipt JSON that is malformed or does not match the manifest/demo hash, has malformed status records, has a manifest signer domain that does not match the launch domain, has an identity `kid` that does not match the manifest key, or has status records that do not match the manifest key/receipt hash
- the latest GitHub Actions `CI` run on `main` is not successful for the current git `HEAD`
- the deployed `/api/health` response is missing, not `ok`, still in demo mode, missing signer domain, site URL, DoH endpoint, or status base URL configuration, or missing bundled status records when the status base URL shares the verifier origin
- the deployed homepage title, canonical URL, Open Graph URL, or share image metadata still points at localhost, a placeholder, or a different launch origin
- the deployed homepage or health response is missing production security headers, the health response is missing `Cache-Control: no-store`, or a development CSP allowance such as `localhost` or `unsafe-eval` is present
- `groundlock warm-cache` does not return `PASS` for the public demo fixture
- `groundlock check-live` does not return `PASS` for the public demo receipt
- the deployed `POST /api/verify` endpoint does not return `PASS` for the public demo receipt or hash, is missing production security headers or `Cache-Control: no-store`, or its `receiptSummary` does not match the launch domain, demo content hash, and DNS fixture receipt hash

## Release checklist

- Public HTTPS verifier deployed.
- Launch URLs and signer domain are real public DNS hosts, not `.example`, `localhost`, malformed DNS names, URL credentials, query/fragment variants, or IP addresses.
- Public homepage renders the `GroundLock Receipts` title and canonical/Open Graph/Twitter image metadata for the same public HTTPS verifier origin.
- Web env generated with `groundlock export-web-env` and installed in the deployment.
- `GROUNDLOCK_SIGNER_DOMAIN` points at the publisher domain.
- `NEXT_PUBLIC_SITE_URL` points at the public HTTPS verifier origin.
- `GROUNDLOCK_DOH_ENDPOINT` points at the same explicit resolver URL used for `warm-cache`, `check-live`, and `hn_readiness.py`.
- `GROUNDLOCK_STATUS_BASE_URL` serves key and claim status JSON. If it shares the verifier origin, bundled status records are configured and valid.
- `GET /api/health` returns `200` on the deployed verifier and reports `signerDomainConfigured`, `siteUrlConfigured`, `dohEndpointConfigured`, and `statusBaseUrlConfigured`; same-origin status deployments also report `statusRecordsConfigured`.
- Deployed homepage, health, and verify responses include production security headers; health and verify responses include `Cache-Control: no-store`.
- Container image builds and its Docker healthcheck passes, if deploying by container.
- DNS TXT identity, manifest, and chunk records are published.
- Zone-file TXT export from `groundlock setup-domain --format zone --ttl <seconds>` has been installed or translated into equivalent provider TXT records.
- `groundlock warm-cache <dns-fixture.json> --doh-endpoint <url>` returns PASS through the configured resolver path.
- `groundlock check-live <file|hash> --domain <domain> --status-base-url <url> --doh-endpoint <url>` returns PASS from the configured resolver path.
- The deployed `POST /api/verify` endpoint returns PASS for the same public demo file or hash, with `receiptSummary.signerDomain` matching the launch domain, `receiptSummary.contentHash` matching the demo hash, and `receiptSummary.receiptHash` matching the DNS fixture manifest receipt hash.
- `scripts/hn_readiness.py --evidence-out <path>` writes a JSON evidence report whose `ok` field is `true`.
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm audit --json` pass.
