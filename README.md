# GroundLock

[![CI](https://github.com/ucsandman/groundlock-receipts/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/ucsandman/groundlock-receipts/actions/workflows/ci.yml)

GroundLock Receipts are signed AI-message proof receipts stored in DNS resolver caches. A publisher can issue a PASS or BLOCK receipt for one canonicalized message, split the signed receipt into TXT-sized chunks, warm configured DNS resolver caches, and let anyone reconstruct and verify the receipt without an account.

GroundLock is narrow by design: it is a non-fabrication guarantee, not a truth oracle.

## What it proves

- The GroundLock canonicalized text hash matches a signed receipt.
- The receipt verdict is PASS or BLOCK.
- Extracted operational facts such as currency amounts, dates, percentages, and registered patterns trace to the source of truth.
- Required facts are present and forbidden patterns are absent.
- The signer domain/key id, DNS cache manifest, TXT chunks, receipt hash, and status records line up.

## What it does not prove

- It does not independently prove that all prose is true.
- It does not prove unmatched prose is complete.
- It does not provide a trusted timestamp.
- It does not mutate production DNS for you.
- It does not replace official C2PA signing or embedding tools.

## Spam and phishing boundary

GroundLock helps with impersonation, not all spam. A verifier can check whether one exact message or hash was signed by
a key tied to the claimed publisher domain and is still active. If a message claims to be from a bank, agency, hospital,
or other publisher but has no valid GroundLock receipt, the verifier can fail closed instead of trusting the claim.

GroundLock does not decide whether signed content is safe, wanted, legal, or morally good. Mail clients, browser
extensions, and agents would still need spam filtering, abuse detection, URL safety checks, and user policy on top of
GroundLock.

## Clean clone

```powershell
git clone https://github.com/ucsandman/groundlock-receipts.git
cd groundlock-receipts
npm install
npm test
npm run typecheck
npm run lint
npm run build
npm run dev --workspace @groundlock/web -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000` and use the public verifier in the first viewport.

## One-command local launch

For a local test run that installs dependencies if needed, builds the workspaces, runs the tests, starts the verifier app, and opens the browser:

```powershell
python .\launch.py
```

Useful options:

```powershell
python .\launch.py --port 3005
python .\launch.py --skip-tests
python .\launch.py --skip-build --no-browser
```

The launcher prints the exact local URL after startup. If the default port `3000` is already in use, it chooses the next free port instead of attaching to the wrong app. It also fails fast if install, build, tests, or GroundLock page readiness fail. Use `--skip-build` or `--skip-tests` only when you intentionally want a faster local UI check.

## Workspaces

- `packages/core` - zero-runtime-dependency engine: canonicalization, extraction, verification, receipts, status, DNS cache manifest/chunk reconstruction, and C2PA interop projection.
- `packages/cli` - publisher CLI and SDK for signing, DNS cache TXT output, local cache fixtures, fixture verification, and C2PA sidecar emission.
- `apps/web` - Next.js verifier API and Show-HN-ready public site.

## Common commands

```powershell
python .\launch.py
npm test
npm run typecheck
npm run lint
npm run build
npm run dev --workspace @groundlock/web -- --hostname 127.0.0.1 --port 3000
docker build -t groundlock-web .
docker run --rm -p 3000:3000 groundlock-web
groundlock generate-key launch-key-1 --out .\keys
groundlock local-publish .\notice.txt --source .\source.json --domain publisher.example --kid launch-key-1 --key .\keys\launch-key-1.private.jwk --public-key .\keys\launch-key-1.public.jwk --out .\published
groundlock launch-kit .\published\dns-fixture.json --out .\published\launch-kit --site-url https://receipts.example.com --status-base-url https://publisher.example/groundlock/status --doh-endpoint https://cloudflare-dns.com/dns-query --file-or-hash .\notice.txt
groundlock export-web-env .\published\dns-fixture.json --status-base-url https://publisher.example/groundlock/status --site-url https://receipts.example.com --doh-endpoint https://cloudflare-dns.com/dns-query
groundlock setup-domain publisher.example --receipt .\receipt.json --public-key .\public.jwk
groundlock setup-domain publisher.example --receipt .\receipt.json --public-key .\public.jwk --format zone --ttl 300
groundlock warm-cache .\published\dns-fixture.json --doh-endpoint https://cloudflare-dns.com/dns-query
groundlock check-live sha256:<hash> --domain publisher.example --status-base-url https://publisher.example/groundlock/status --doh-endpoint https://cloudflare-dns.com/dns-query
python .\scripts\hn_readiness.py --health-url https://publisher.example --dns-fixture .\published\dns-fixture.json --file-or-hash sha256:<hash> --domain publisher.example --status-base-url https://publisher.example/groundlock/status --doh-endpoint https://cloudflare-dns.com/dns-query --evidence-out .\published\hn-readiness-evidence.json
```

## 60-second verify

See [docs/quickstart-60-second-verify.md](docs/quickstart-60-second-verify.md) for a copy-paste PowerShell flow that signs a sample, writes local DNS cache TXT/status fixtures, reconstructs the receipt from TXT chunks, and verifies PASS.

## API

See [docs/api-reference.md](docs/api-reference.md) for `/api/health`, `/api/verify` request/response shapes, rate limits, payload limits, and PASS/BLOCK/UNVERIFIABLE/REVOKED examples.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the data flow across core, DNS cache manifest/chunk records, CLI, status/revocation, privacy modes, C2PA interop, and the web verifier.

## Deployment

See [docs/deployment.md](docs/deployment.md) for production web verifier configuration, DNS TXT record requirements, resolver-cache warming, and status endpoint shapes.

For public launch prep, `groundlock launch-kit <dns-fixture.json> --out <dir> ...` writes the deployment bundle from one verified fixture: `web.env`, `dns-zone.txt`, `status-records.json`, `launch-summary.json`, `checksums.txt`, a copied `dns-fixture.json`, and `hn-readiness.ps1`. It refuses BLOCK receipts so the Show HN demo cannot accidentally ship a negative verification path.

The web verifier can run as a container:

```powershell
docker build -t groundlock-web .
docker run --rm -p 3000:3000 groundlock-web
```

## Threat model

See [docs/threat-model.md](docs/threat-model.md) for canonicalized-hash limits, DNS cache availability limits, attacker capabilities, fail-closed states, key rotation, revocation, C2PA interop boundaries, and private workflow leakage.

## Security

See [SECURITY.md](SECURITY.md) for the reporting policy and the public verifier boundary. The public web verifier must not issue signed receipts or hold receipt-signing private keys.

## C2PA interop

GroundLock composes with C2PA rather than replacing it. The current interop target is the official C2PA Technical Specification 2.4 (April 2026): https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html.

`createC2paInteropSidecar(receipt, opts)` emits deterministic JSON metadata with a C2PA-compatible manifest projection and a GroundLock assertion reference. The sidecar includes the claim generator, canonicalized content hash plus canonicalization id, GroundLock receipt hash, signer domain/key id, content class, and a full receipt reference.

This sidecar is interop metadata only. It is not an official C2PA manifest store, C2PA embed/sign workflow, JUMBF box, or replacement for C2PA tooling. Use official C2PA tools for signing and embedding content credentials; use GroundLock DNS cache records as the public reconstruction and verification layer for the receipt.

```powershell
groundlock sign .\notice.txt --source .\source.json --domain publisher.example --kid k1 --key .\private.jwk --out .\receipt.json --c2pa-sidecar .\receipt.c2pa-sidecar.json --receipt-ref https://publisher.example/receipts/notice.json --asset-format text/plain
```

## Environment

The local web verifier does not require environment variables or secrets. It reconstructs and verifies demo DNS-cache receipt fixtures; it does not issue receipts.

Production verifier mode is enabled by `GROUNDLOCK_SIGNER_DOMAIN`, with `GROUNDLOCK_DOH_ENDPOINT` and `GROUNDLOCK_STATUS_BASE_URL` set for public launch.
Public verifier rate limits default to `240` requests per `60000` ms per app instance and can be tuned with `GROUNDLOCK_RATE_LIMIT_MAX` and `GROUNDLOCK_RATE_LIMIT_WINDOW_MS`.
Use `.env.example` for placeholder names and deployment shape; never commit real `.env` files.

Publisher signing keys belong in the CLI or a separately authenticated publisher workflow, not the public verifier deployment.

Never commit `.env`, `.env.local`, or real private keys.

## Show HN

See [docs/show-hn-draft.md](docs/show-hn-draft.md). The current draft is marked `LOCAL_DEMO_ONLY` until stable resolver-cache warming, an explicit deployed DoH endpoint, and status endpoints are configured.

After the public deployment is live, run the fail-closed launch audit before removing that marker. It checks CI, public HTTPS launch targets, live verifier health, homepage canonical/share metadata, resolver-cache warming, live receipt verification, and the deployed `/api/verify` endpoint:

```powershell
python .\scripts\hn_readiness.py --health-url https://publisher.example --dns-fixture .\published\dns-fixture.json --file-or-hash sha256:<hash> --domain publisher.example --status-base-url https://publisher.example/groundlock/status --doh-endpoint https://cloudflare-dns.com/dns-query --evidence-out .\published\hn-readiness-evidence.json
```

## License

MIT. See [LICENSE](LICENSE).
