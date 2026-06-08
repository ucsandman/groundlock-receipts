# Show HN draft

Title:

```text
Show HN: GroundLock Receipts - AI proof receipts stored in DNS caches
```

Body:

```text
LOCAL_DEMO_ONLY

I built GroundLock Receipts, an experiment that turns the DNSFS idea into a signed proof system for AI-generated business messages. A publisher can issue a signed PASS or BLOCK receipt for one canonicalized message, split that receipt into DNS TXT chunks, warm resolver caches, and let anyone reconstruct and verify it without an account.

The verifier is intentionally narrow:
- Paste text content or a GroundLock sha256 hash.
- It reconstructs the receipt from DNS resolver-cache TXT manifest/chunk records.
- It checks the cache payload hash, receipt hash, Ed25519 signature, grounding verdict, and revocation status.
- It returns PASS, BLOCK, REVOKED, or UNVERIFIABLE.

The core idea is that counterparties should not have to trust a screenshot, a chatbot transcript, or a vendor dashboard when checking whether an AI-generated notice was grounded against source facts.

What it does not do:
- It does not adjudicate truth.
- It does not prove unmatched prose is complete.
- It does not provide a trusted timestamp.
- It does not mutate production DNS.
- It does not guarantee resolver caches retain chunks forever.
- It does not replace official C2PA signing/embedding.

Local demo:
1. git clone https://github.com/ucsandman/groundlock-receipts.git
2. npm install
3. npm test && npm run typecheck && npm run build
4. npm run dev --workspace @groundlock/web -- --hostname 127.0.0.1 --port 3000
5. Open http://127.0.0.1:3000 and run the PASS/BLOCK/REVOKED samples.

CLI demo:
docs/quickstart-60-second-verify.md signs a local sample, writes local DNS-cache TXT/status fixtures, reconstructs the receipt from TXT chunks, and verifies PASS from the CLI.

Deployment notes:
docs/deployment.md documents live verifier mode with GROUNDLOCK_SIGNER_DOMAIN, DNS-over-HTTPS TXT lookups, resolver-cache warming, and HTTP key/claim status endpoints.
The release gate is `groundlock check-live <file-or-hash> --domain <domain> --status-base-url <url>` returning PASS against the configured resolver path.

Before removing LOCAL_DEMO_ONLY, deployment needs:
- public HTTPS deployment of the web verifier
- stable publisher signing key managed outside the public verifier
- configured resolver-cache warming path
- configured GROUNDLOCK_SIGNER_DOMAIN and GROUNDLOCK_STATUS_BASE_URL
- _truename.<domain> TXT identity record
- gl-<hash>._groundlock.<domain> TXT manifest records
- c<N>.gl-<hash>._groundlock.<domain> TXT receipt chunk records
- reachable key and claim status records
- public demo fixtures that do not contain secrets or private customer data
- check-live PASS evidence for at least one public demo receipt

Repo:
https://github.com/ucsandman/groundlock-receipts

License:
MIT
```
