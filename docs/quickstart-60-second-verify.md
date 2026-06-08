# 60-second verify quickstart

This PowerShell flow signs a local sample, writes local DNS-cache TXT/status fixtures, reconstructs the signed receipt from TXT chunks, and verifies PASS. It does not mutate production DNS.

## From a clean clone

```powershell
git clone https://github.com/ucsandman/groundlock-receipts.git
cd groundlock-receipts
npm install
npm run build --workspace @groundlock/core
npm run build --workspace @groundlock/cli
```

To start the full local verifier app instead of only running the CLI quickstart, use:

```powershell
python .\launch.py
```

Follow the URL printed by the launcher. If port `3000` is busy, it automatically picks the next free port.

## Create a sample outside the repo

```powershell
$dir = Join-Path $env:TEMP "groundlock-quickstart"
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$sourcePath = Join-Path $dir "source.json"
$samplePath = Join-Path $dir "notice.txt"
$publishDir = Join-Path $dir "published"

Set-Content -Path $sourcePath -Encoding utf8 -Value '{"requiredFacts":[{"label":"tenant","value":"Jane Roe"}],"allowedFacts":[{"label":"amount","value":"$2,000.00"}],"extract":{"money":true,"dates":false,"percentages":false}}'
Set-Content -Path $samplePath -Encoding utf8 -Value 'Dear Jane Roe, return $2,000.00.'
```

## Generate a demo keypair

```powershell
$keyJson = node --input-type=module -e "import { generateSigningKey } from './packages/core/dist/index.js'; process.stdout.write(JSON.stringify(generateSigningKey('quickstart-key')));"
$key = $keyJson | ConvertFrom-Json
$privateJwk = $key.privateKeyJwk | ConvertTo-Json -Compress
$publicJwk = $key.publicKeyJwk | ConvertTo-Json -Compress
```

Do not commit demo keys. For production, use managed key storage in the publisher workflow; the public web verifier should not hold a receipt-signing private key.

## Publish local fixtures

```powershell
node .\packages\cli\dist\cli.js local-publish $samplePath --source $sourcePath --domain publisher.example --kid quickstart-key --key $privateJwk --public-key $publicJwk --out $publishDir
```

Expected output:

```text
receipt <temp>\groundlock-quickstart\published\receipts\sha256_wcOEI6HWksnG9nJNekJjb88DbtUTdSr-qyrjbHPZIcw.json
status <temp>\groundlock-quickstart\published\status\claim.json
fixture <temp>\groundlock-quickstart\published\dns-fixture.json
_truename.publisher.example TXT ...
cache-manifest gl-..._groundlock.publisher.example TXT ...
cache-chunk 0 c0.gl-..._groundlock.publisher.example TXT ...
cache-chunk 1 c1.gl-..._groundlock.publisher.example TXT ...
```

## Verify PASS

```powershell
node .\packages\cli\dist\cli.js verify $samplePath --fixture (Join-Path $publishDir "dns-fixture.json") --domain publisher.example
```

Expected output:

```text
PASS verified - DNS cache receipt verified
```

## Production live check

After publishing real TXT records and status endpoints, verify the public path with:

```powershell
groundlock export-web-env (Join-Path $publishDir "dns-fixture.json") --status-base-url https://publisher.example/groundlock/status --doh-endpoint https://cloudflare-dns.com/dns-query
$receiptPath = Get-ChildItem -Path (Join-Path $publishDir "receipts") -Filter "*.json" | Select-Object -First 1 -ExpandProperty FullName
groundlock setup-domain publisher.example --receipt $receiptPath --public-key $publicJwk
groundlock warm-cache (Join-Path $publishDir "dns-fixture.json") --doh-endpoint https://cloudflare-dns.com/dns-query
groundlock check-live $samplePath --domain publisher.example --status-base-url https://publisher.example/groundlock/status --doh-endpoint https://cloudflare-dns.com/dns-query
```

`export-web-env` prints the web deployment variables, including `GROUNDLOCK_STATUS_RECORDS_JSON`. `setup-domain` prints the required TXT records and does not mutate DNS. `warm-cache` queries every expected DNS TXT fixture name through the configured DoH resolver and fails if the answer set differs. `check-live` uses DNS-over-HTTPS TXT lookups plus public key/claim status endpoints. It returns PASS only when the deployed resolver and status path can reconstruct and verify the receipt.

## Emit a C2PA interop sidecar

```powershell
node .\packages\cli\dist\cli.js sign $samplePath --source $sourcePath --domain publisher.example --kid quickstart-key --key $privateJwk --out (Join-Path $dir "receipt.json") --c2pa-sidecar (Join-Path $dir "receipt.c2pa-sidecar.json") --receipt-ref https://publisher.example/receipts/notice.json --asset-format text/plain
```

The sidecar is interop metadata only. Use official C2PA tools for embedding/signing content credentials.
