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

Do not commit demo keys. For production, use managed key storage and set `GROUNDLOCK_SIGNING_KEY_JWK` only through your deployment secret manager.

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

## Emit a C2PA interop sidecar

```powershell
node .\packages\cli\dist\cli.js sign $samplePath --source $sourcePath --domain publisher.example --kid quickstart-key --key $privateJwk --out (Join-Path $dir "receipt.json") --c2pa-sidecar (Join-Path $dir "receipt.c2pa-sidecar.json") --receipt-ref https://publisher.example/receipts/notice.json --asset-format text/plain
```

The sidecar is interop metadata only. Use official C2PA tools for embedding/signing content credentials.
