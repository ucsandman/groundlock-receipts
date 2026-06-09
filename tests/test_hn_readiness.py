import base64
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from scripts import hn_readiness


ISSUED_AT = "2026-06-08T00:00:00.000Z"


def identity_record(kid: str, x: str = "abc") -> str:
    jwk = (
        base64.urlsafe_b64encode(
            json.dumps(
                {"crv": "Ed25519", "kty": "OKP", "x": x},
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        )
        .decode("ascii")
        .rstrip("=")
    )
    return f"glt1 kid={kid} alg=EdDSA jwk={jwk}"


def active_status_records(
    signer_domain: str = "receipts.groundlock.dev",
    kid: str = "k1",
    receipt_hash: str = "sha256:abc",
) -> dict[str, object]:
    return {
        "key": {
            "version": "groundlock-status/v1",
            "kind": "key",
            "subject": {"signerDomain": signer_domain, "kid": kid},
            "status": "active",
            "issuedAt": ISSUED_AT,
        },
        "claim": {
            "version": "groundlock-status/v1",
            "kind": "claim",
            "subject": {"receiptHash": receipt_hash},
            "status": "active",
            "issuedAt": ISSUED_AT,
        },
    }


def base64url_json(value: object) -> str:
    return (
        base64.urlsafe_b64encode(hn_readiness.canonical_json(value).encode("utf-8"))
        .decode("ascii")
        .rstrip("=")
    )


def cached_receipt_parts(
    content_hash: str = "sha256:abc",
    signer_domain: str = "receipts.groundlock.dev",
    kid: str = "k1",
) -> dict[str, object]:
    source_hash = "sha256:source"
    receipt = {
        "version": "groundlock-receipt/v1",
        "issuedAt": ISSUED_AT,
        "engineVersion": "test",
        "verdict": "pass",
        "violations": [],
        "candidateHash": content_hash,
        "sourceOfTruthHash": source_hash,
        "sourceHash": source_hash,
        "contentHashes": [
            {
                "role": "candidate",
                "alg": "sha256",
                "value": content_hash,
                "canonicalization": "groundlock:text:nfc-v1",
            },
            {
                "role": "source",
                "alg": "sha256",
                "value": source_hash,
                "canonicalization": "groundlock:source:test",
            },
        ],
        "signerKeyId": kid,
        "signerDomain": signer_domain,
        "contentClass": "notice",
        "groundedClaims": [],
        "signature": {"alg": "EdDSA", "kid": kid, "sig": "test-signature"},
    }
    payload = base64url_json(receipt)
    return {
        "receipt": receipt,
        "payload": payload,
        "receipt_hash": hn_readiness.receipt_status_hash(receipt),
    }


def manifest_record(
    receipt_hash: str = "abc",
    payload: str = "abc",
    chunk_count: int = 1,
    signer_domain: str = "receipts.groundlock.dev",
    kid: str = "k1",
) -> str:
    payload_hash = hn_readiness.digest_utf8(payload).removeprefix("sha256:")
    return (
        f"gdm1 rh={receipt_hash} ph={payload_hash} n={chunk_count} "
        f"key={signer_domain}#{kid}"
    )


def manifest_record_for_parts(
    parts: dict[str, object],
    chunk_count: int = 1,
    signer_domain: str = "receipts.groundlock.dev",
    kid: str = "k1",
) -> str:
    return manifest_record(
        receipt_hash=str(parts["receipt_hash"]).removeprefix("sha256:"),
        payload=str(parts["payload"]),
        chunk_count=chunk_count,
        signer_domain=signer_domain,
        kid=kid,
    )


def active_status_for_parts(
    parts: dict[str, object],
    signer_domain: str = "receipts.groundlock.dev",
    kid: str = "k1",
) -> dict[str, object]:
    return active_status_records(
        signer_domain=signer_domain,
        kid=kid,
        receipt_hash=str(parts["receipt_hash"]),
    )


def chunk_record(parts: dict[str, object], index: int = 0) -> str:
    return f"gdc1 i={index} d={parts['payload']}"


def production_security_headers(
    *, csp: str | None = None, cache_control: str | None = None
) -> dict[str, str]:
    headers = {
        name: "; ".join(values)
        for name, values in hn_readiness.SECURITY_HEADER_REQUIREMENTS.items()
    }
    if csp is not None:
        headers["Content-Security-Policy"] = csp
    if cache_control is not None:
        headers["Cache-Control"] = cache_control
    return headers


def zone_txt_line(name: str, value: str, ttl: int = 300) -> str:
    segments = [
        value[offset : offset + 255] for offset in range(0, len(value), 255)
    ] or [""]
    escaped = [
        segment.replace("\\", "\\\\").replace('"', '\\"') for segment in segments
    ]
    quoted = " ".join(f'"{segment}"' for segment in escaped)
    return f"{name}. {ttl} IN TXT {quoted}"


def ps_escape(value: str) -> str:
    return value.replace("`", "``").replace('"', '`"')


def hn_readiness_ps1(
    *,
    site_url: str,
    status_base_url: str,
    doh_endpoint: str,
    domain: str,
    file_or_hash: str,
) -> str:
    return "\n".join(
        [
            '$ErrorActionPreference = "Stop"',
            "$KitDir = Split-Path -Parent $MyInvocation.MyCommand.Path",
            '$RepoRoot = $CandidateRoots | Where-Object { Test-Path (Join-Path $_ "scripts\\hn_readiness.py") } | Select-Object -First 1',
            "Push-Location $RepoRoot",
            "try {",
            "  python .\\scripts\\hn_readiness.py `",
            f'  --health-url "{ps_escape(site_url)}" `',
            '  --dns-fixture (Join-Path $KitDir "dns-fixture.json") `',
            f'  --file-or-hash "{ps_escape(file_or_hash)}" `',
            f'  --domain "{ps_escape(domain)}" `',
            f'  --status-base-url "{ps_escape(status_base_url)}" `',
            f'  --doh-endpoint "{ps_escape(doh_endpoint)}" `',
            f'  --repo "{hn_readiness.DEFAULT_REPO}" `',
            '  --branch "main" `',
            '  --show-hn-draft "docs/show-hn-draft.md" `',
            "  --launch-kit $KitDir `",
            '  --evidence-out (Join-Path $KitDir "hn-readiness-evidence.json")',
            "} finally {",
            "  Pop-Location",
            "}",
            "",
        ]
    )


def launch_runbook(
    *,
    site_url: str,
    status_base_url: str,
    doh_endpoint: str,
    domain: str,
    file_or_hash: str,
) -> str:
    return "\n".join(
        [
            "# GroundLock launch runbook",
            "",
            "- `dns-fixture.json`",
            "- `dns-zone.txt`",
            "- `web.env`",
            "- `status-records.json`",
            "- `hn-readiness.ps1`",
            "",
            "```powershell",
            f'docker build --build-arg NEXT_PUBLIC_SITE_URL="{ps_escape(site_url)}" -t groundlock-web .',
            "```",
            "",
            f"Serve the key and claim status records from `status-records.json` at `{status_base_url}`.",
            "",
            "```powershell",
            f'groundlock warm-cache .\\dns-fixture.json --doh-endpoint "{ps_escape(doh_endpoint)}"',
            (
                f'groundlock check-live "{ps_escape(file_or_hash)}" '
                f'--domain "{ps_escape(domain)}" '
                f'--status-base-url "{ps_escape(status_base_url)}" '
                f'--doh-endpoint "{ps_escape(doh_endpoint)}"'
            ),
            ".\\hn-readiness.ps1",
            "```",
            "",
            "Compare `checksums.txt` with `launch-summary.json.artifactSha256`.",
            "",
            f"Repository: {hn_readiness.DEFAULT_REPO}",
            "Branch: main",
            "",
        ]
    )


def write_launch_kit(
    root: Path,
    *,
    domain: str = "receipts.groundlock.dev",
    site_url: str = "https://receipts.groundlock.dev",
    status_base_url: str = "https://receipts.groundlock.dev/groundlock/status",
    doh_endpoint: str = "https://resolver.groundlock.dev/dns-query",
    content_hash: str = "sha256:abc123",
) -> Path:
    kit = root / "launch-kit"
    kit.mkdir()
    kid = "k1"
    parts = cached_receipt_parts(
        content_hash=content_hash, signer_domain=domain, kid=kid
    )
    manifest_label = hn_readiness.cache_label(content_hash)
    status = active_status_for_parts(parts, signer_domain=domain, kid=kid)
    fixture = {
        "domain": domain,
        "txt": {
            f"_truename.{domain}": [identity_record(kid)],
            f"gl-{manifest_label}._groundlock.{domain}": [
                manifest_record_for_parts(parts, signer_domain=domain, kid=kid)
            ],
            f"c0.gl-{manifest_label}._groundlock.{domain}": [chunk_record(parts)],
        },
        "status": status,
    }
    status_records = [status["key"], status["claim"]]
    status_records_json = json.dumps(status_records, separators=(",", ":"))
    zone = "\n".join(
        zone_txt_line(name, value)
        for name, values in sorted(fixture["txt"].items())
        for value in values
    )
    zone += "\n"
    artifact_contents = {
        "dnsFixture": json.dumps(fixture, indent=2, sort_keys=True) + "\n",
        "dnsZone": zone,
        "webEnv": "\n".join(
            [
                f"GROUNDLOCK_SIGNER_DOMAIN={domain}",
                f"NEXT_PUBLIC_SITE_URL={site_url}",
                f"GROUNDLOCK_DOH_ENDPOINT={doh_endpoint}",
                f"GROUNDLOCK_STATUS_BASE_URL={status_base_url}",
                "GROUNDLOCK_FETCH_TIMEOUT_MS=5000",
                f"GROUNDLOCK_STATUS_RECORDS_JSON={status_records_json}",
            ]
        )
        + "\n",
        "statusRecords": json.dumps(status_records, indent=2, sort_keys=True) + "\n",
        "hnReadiness": hn_readiness_ps1(
            site_url=site_url,
            status_base_url=status_base_url,
            doh_endpoint=doh_endpoint,
            domain=domain,
            file_or_hash=content_hash,
        ),
        "runbook": launch_runbook(
            site_url=site_url,
            status_base_url=status_base_url,
            doh_endpoint=doh_endpoint,
            domain=domain,
            file_or_hash=content_hash,
        ),
    }
    for key, text in artifact_contents.items():
        (kit / hn_readiness.LAUNCH_KIT_ARTIFACTS[key]).write_text(
            text, encoding="utf-8"
        )
    artifact_sha256 = {
        key: hn_readiness.file_sha256(kit / hn_readiness.LAUNCH_KIT_ARTIFACTS[key])
        for key in hn_readiness.LAUNCH_KIT_CHECKSUMMED_ARTIFACTS
    }
    summary = {
        "schema": "groundlock-launch-kit/v1",
        "domain": domain,
        "siteUrl": site_url,
        "healthUrl": site_url,
        "statusBaseUrl": status_base_url,
        "dohEndpoint": doh_endpoint,
        "fileOrHash": content_hash,
        "contentHash": content_hash,
        "receiptHash": str(parts["receipt_hash"]),
        "signerKeyId": kid,
        "fetchTimeoutMs": 5000,
        "receiptVerdict": "pass",
        "receiptIssuedAt": ISSUED_AT,
        "contentClass": "notice",
        "dnsTxtRecordCount": len(fixture["txt"]),
        "statusRecordCount": 2,
        "artifacts": hn_readiness.LAUNCH_KIT_ARTIFACTS,
        "artifactSha256": artifact_sha256,
    }
    (kit / "launch-summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    checksums = "".join(
        f"{artifact_sha256[key]}  {artifact_name}\n"
        for key, artifact_name in hn_readiness.LAUNCH_KIT_CHECKSUMMED_ARTIFACTS.items()
    )
    (kit / "checksums.txt").write_text(checksums, encoding="utf-8")
    return kit


def refresh_launch_kit_hashes(kit: Path) -> None:
    summary_path = kit / "launch-summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    artifact_sha256 = {
        key: hn_readiness.file_sha256(kit / hn_readiness.LAUNCH_KIT_ARTIFACTS[key])
        for key in hn_readiness.LAUNCH_KIT_CHECKSUMMED_ARTIFACTS
    }
    summary["artifactSha256"] = artifact_sha256
    summary_path.write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    checksums = "".join(
        f"{artifact_sha256[key]}  {artifact_name}\n"
        for key, artifact_name in hn_readiness.LAUNCH_KIT_CHECKSUMMED_ARTIFACTS.items()
    )
    (kit / "checksums.txt").write_text(checksums, encoding="utf-8")


class HnReadinessTests(unittest.TestCase):
    def test_show_hn_draft_fails_while_marked_local_demo_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            draft = Path(tmp) / "show-hn-draft.md"
            draft.write_text("LOCAL_DEMO_ONLY\n", encoding="utf-8")

            result = hn_readiness.check_show_hn_draft(draft)

        self.assertFalse(result.ok)
        self.assertEqual(result.name, "show-hn-draft")
        self.assertIn("LOCAL_DEMO_ONLY", result.detail)

    def test_health_check_requires_live_mode(self) -> None:
        response = hn_readiness.validate_health_body(
            json.dumps(
                {
                    "service": "groundlock-web",
                    "ok": True,
                    "mode": "demo",
                    "checks": {
                        "signerDomainConfigured": False,
                        "siteUrlConfigured": False,
                        "dohEndpointConfigured": False,
                        "statusBaseUrlConfigured": False,
                    },
                }
            )
        )

        self.assertFalse(response.ok)
        self.assertIn("live", response.detail)

    def test_health_check_accepts_live_ready_body(self) -> None:
        response = hn_readiness.validate_health_body(
            json.dumps(
                {
                    "service": "groundlock-web",
                    "ok": True,
                    "mode": "live",
                    "checks": {
                        "signerDomainConfigured": True,
                        "siteUrlConfigured": True,
                        "dohEndpointConfigured": True,
                        "statusBaseUrlConfigured": True,
                    },
                }
            )
        )

        self.assertTrue(response.ok)

    def test_health_check_requires_status_records_for_same_origin_status(self) -> None:
        response = hn_readiness.validate_health_body(
            json.dumps(
                {
                    "service": "groundlock-web",
                    "ok": True,
                    "mode": "live",
                    "checks": {
                        "signerDomainConfigured": True,
                        "siteUrlConfigured": True,
                        "dohEndpointConfigured": True,
                        "statusBaseUrlConfigured": True,
                        "statusRecordsConfigured": False,
                    },
                }
            ),
            health_url="https://receipts.groundlock.dev/api/health",
            status_base_url="https://receipts.groundlock.dev/groundlock/status",
        )

        self.assertFalse(response.ok)
        self.assertIn("statusRecordsConfigured", response.detail)

    def test_health_check_allows_external_status_records_without_bundle(self) -> None:
        response = hn_readiness.validate_health_body(
            json.dumps(
                {
                    "service": "groundlock-web",
                    "ok": True,
                    "mode": "live",
                    "checks": {
                        "signerDomainConfigured": True,
                        "siteUrlConfigured": True,
                        "dohEndpointConfigured": True,
                        "statusBaseUrlConfigured": True,
                        "statusRecordsConfigured": False,
                    },
                }
            ),
            health_url="https://receipts.groundlock.dev",
            status_base_url="https://publisher.groundlock.dev/groundlock/status",
        )

        self.assertTrue(response.ok)

    def test_health_check_requires_deployed_doh_endpoint_for_launch(self) -> None:
        response = hn_readiness.validate_health_body(
            json.dumps(
                {
                    "service": "groundlock-web",
                    "ok": True,
                    "mode": "live",
                    "checks": {
                        "signerDomainConfigured": True,
                        "siteUrlConfigured": True,
                        "dohEndpointConfigured": False,
                        "statusBaseUrlConfigured": True,
                    },
                }
            )
        )

        self.assertFalse(response.ok)
        self.assertIn("dohEndpointConfigured", response.detail)

    def test_launch_targets_reject_placeholders_local_and_non_https(self) -> None:
        result = hn_readiness.check_launch_targets(
            SimpleNamespace(
                health_url="http://localhost:3000",
                status_base_url="https://publisher.example/groundlock/status",
                doh_endpoint="http://127.0.0.1:8053/dns-query",
                domain="publisher.example",
            )
        )

        self.assertFalse(result.ok)
        self.assertEqual(result.name, "launch-targets")
        self.assertIn("health-url must use https", result.detail)
        self.assertIn("private or local IP", result.detail)
        self.assertIn("reserved placeholder", result.detail)

    def test_launch_targets_accept_public_https_values(self) -> None:
        result = hn_readiness.check_launch_targets(
            SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://cloudflare-dns.com/dns-query",
                domain="receipts.groundlock.dev",
            )
        )

        self.assertTrue(result.ok)

    def test_launch_targets_accept_health_endpoint_path(self) -> None:
        result = hn_readiness.check_launch_targets(
            SimpleNamespace(
                health_url="https://receipts.groundlock.dev/api/health",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://cloudflare-dns.com/dns-query",
                domain="receipts.groundlock.dev",
            )
        )

        self.assertTrue(result.ok)

    def test_launch_targets_reject_nested_health_url_paths(self) -> None:
        result = hn_readiness.check_launch_targets(
            SimpleNamespace(
                health_url="https://receipts.groundlock.dev/app",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://cloudflare-dns.com/dns-query",
                domain="receipts.groundlock.dev",
            )
        )

        self.assertFalse(result.ok)
        self.assertIn("health-url path must be / or /api/health", result.detail)

    def test_launch_targets_require_explicit_doh_endpoint_for_hn_launch(self) -> None:
        result = hn_readiness.check_launch_targets(
            SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint=None,
                domain="receipts.groundlock.dev",
            )
        )

        self.assertFalse(result.ok)
        self.assertEqual(result.name, "launch-targets")
        self.assertIn("doh-endpoint", result.detail)

    def test_launch_targets_reject_ambiguous_urls_and_malformed_domains(self) -> None:
        result = hn_readiness.check_launch_targets(
            SimpleNamespace(
                health_url="https://user:pass@bad_label.groundlock.dev/api/health?x=1",
                status_base_url="https://publisher.groundlock.dev/groundlock/status#fragment",
                doh_endpoint="https://resolver.groundlock.dev/dns-query?bootstrap=1",
                domain="8.8.8.8",
            )
        )

        self.assertFalse(result.ok)
        self.assertIn("health-url must not include username or password", result.detail)
        self.assertIn("health-url must not include query or fragment", result.detail)
        self.assertIn("health-url must be a valid public DNS name", result.detail)
        self.assertIn(
            "status-base-url must not include query or fragment", result.detail
        )
        self.assertIn("doh-endpoint must not include query or fragment", result.detail)
        self.assertIn("domain must be a DNS name, not an IP address", result.detail)

    def test_response_headers_require_production_security_headers(self) -> None:
        ok = hn_readiness.validate_response_headers(
            production_security_headers(), "homepage"
        )
        missing = hn_readiness.validate_response_headers({}, "homepage")
        dev_csp = hn_readiness.validate_response_headers(
            production_security_headers(
                csp=(
                    "default-src 'self'; base-uri 'self'; form-action 'self'; "
                    "frame-ancestors 'none'; object-src 'none'; connect-src 'self'; "
                    "script-src 'self' 'unsafe-eval'; upgrade-insecure-requests"
                )
            ),
            "homepage",
        )

        self.assertEqual(ok, [])
        self.assertTrue(any("Content-Security-Policy" in item for item in missing))
        self.assertIn("'unsafe-eval'", "; ".join(dev_csp))

    def test_response_headers_load_shared_contract(self) -> None:
        self.assertIn(
            "Content-Security-Policy", hn_readiness.SECURITY_HEADER_REQUIREMENTS
        )
        self.assertIn("localhost", hn_readiness.FORBIDDEN_CSP_VALUES)
        self.assertIn("127.0.0.1", hn_readiness.FORBIDDEN_CSP_VALUES)
        self.assertIn(
            "upgrade-insecure-requests",
            hn_readiness.SECURITY_HEADER_REQUIREMENTS["Content-Security-Policy"],
        )

    def test_response_headers_require_no_store_for_api_responses(self) -> None:
        ok = hn_readiness.validate_response_headers(
            production_security_headers(cache_control="no-store"),
            "health",
            require_no_store=True,
        )
        missing = hn_readiness.validate_response_headers(
            production_security_headers(), "health", require_no_store=True
        )

        self.assertEqual(ok, [])
        self.assertIn("Cache-Control: no-store", "; ".join(missing))

    def test_homepage_url_strips_health_endpoint(self) -> None:
        self.assertEqual(
            hn_readiness.homepage_url(
                "https://receipts.groundlock.dev/api/health?check=true"
            ),
            "https://receipts.groundlock.dev/",
        )

    def test_verify_endpoint_strips_health_endpoint(self) -> None:
        self.assertEqual(
            hn_readiness.verify_endpoint("https://receipts.groundlock.dev/api/health"),
            "https://receipts.groundlock.dev/api/verify",
        )

    def test_builds_web_verify_request_from_hash_or_file(self) -> None:
        self.assertEqual(
            hn_readiness.build_web_verify_body("sha256:abc123"),
            {"hash": "sha256:abc123"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            sample = Path(tmp) / "notice.txt"
            sample.write_text("Dear Jane Roe, return $2,000.00.", encoding="utf-8")

            self.assertEqual(
                hn_readiness.build_web_verify_body(str(sample)),
                {"fileText": "Dear Jane Roe, return $2,000.00."},
            )

    def test_web_verify_response_requires_pass(self) -> None:
        summary = {
            "signerDomain": "receipts.groundlock.dev",
            "contentHash": "sha256:abc",
            "verdict": "pass",
            "receiptHash": "sha256:receipt",
        }
        ok = hn_readiness.validate_web_verify_body(
            json.dumps(
                {"state": "PASS", "code": "verified", "receiptSummary": summary}
            ),
            "receipts.groundlock.dev",
            "sha256:abc",
            "sha256:receipt",
        )
        bad = hn_readiness.validate_web_verify_body(
            json.dumps({"state": "UNVERIFIABLE", "code": "dns_txt_missing"}),
            "receipts.groundlock.dev",
            "sha256:abc",
            "sha256:receipt",
        )

        self.assertTrue(ok.ok)
        self.assertEqual(ok.name, "web-verify")
        self.assertFalse(bad.ok)
        self.assertIn("UNVERIFIABLE", bad.detail)

    def test_web_verify_response_requires_matching_receipt_summary(self) -> None:
        base_summary = {
            "signerDomain": "receipts.groundlock.dev",
            "contentHash": "sha256:abc",
            "verdict": "pass",
            "receiptHash": "sha256:receipt",
        }
        cases = [
            (None, "receiptSummary"),
            ({**base_summary, "signerDomain": "other.groundlock.dev"}, "signerDomain"),
            ({**base_summary, "contentHash": "sha256:other"}, "contentHash"),
            ({**base_summary, "verdict": "block"}, "verdict"),
            ({**base_summary, "receiptHash": "receipt"}, "receiptHash"),
            ({**base_summary, "receiptHash": "sha256:other"}, "receiptHash"),
        ]
        for summary, expected_detail in cases:
            with self.subTest(expected_detail=expected_detail):
                body = {"state": "PASS", "code": "verified"}
                if summary is not None:
                    body["receiptSummary"] = summary

                result = hn_readiness.validate_web_verify_body(
                    json.dumps(body),
                    "receipts.groundlock.dev",
                    "sha256:abc",
                    "sha256:receipt",
                )

                self.assertFalse(result.ok)
                self.assertIn(expected_detail, result.detail)

    def test_dns_fixture_preflight_accepts_launch_domain_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            parts = cached_receipt_parts()
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1")
                            ],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                manifest_record_for_parts(parts)
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                chunk_record(parts)
                            ],
                        },
                        "status": active_status_for_parts(parts),
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )
            manifest = hn_readiness.fixture_manifest_for_input(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertTrue(result.ok)
        self.assertEqual(result.name, "dns-fixture")
        self.assertEqual(manifest.receipt_hash, parts["receipt_hash"])
        self.assertEqual(manifest.signer_domain, "receipts.groundlock.dev")

    def test_dns_fixture_preflight_rejects_malformed_manifest_record(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1")
                            ],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                "gdm1 rh=abc n=1 key=receipts.groundlock.dev#k1"
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                "gdc1 i=0 d=abc"
                            ],
                        },
                        "status": active_status_records(),
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("manifest TXT", result.detail)
        self.assertIn("malformed", result.detail)

    def test_dns_fixture_preflight_rejects_ambiguous_manifest_record(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1")
                            ],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                "gdm1 rh=abc ph=def n=1 key=receipts.groundlock.dev#k1",
                                "gdm1 rh=abc ph=ghi n=1 key=receipts.groundlock.dev#k1",
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                "gdc1 i=0 d=abc"
                            ],
                        },
                        "status": active_status_records(),
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("manifest TXT", result.detail)
        self.assertIn("ambiguous", result.detail)

    def test_dns_fixture_preflight_rejects_malformed_or_ambiguous_chunks(
        self,
    ) -> None:
        cases = [
            (["gdc1 i=0 d=not*base64url"], "malformed"),
            (["gdc1 i=0 d=abc", "gdc1 i=0 d=def"], "ambiguous"),
        ]
        for chunk_values, expected_detail in cases:
            with self.subTest(expected_detail=expected_detail):
                with tempfile.TemporaryDirectory() as tmp:
                    fixture = Path(tmp) / "dns-fixture.json"
                    fixture.write_text(
                        json.dumps(
                            {
                                "domain": "receipts.groundlock.dev",
                                "txt": {
                                    "_truename.receipts.groundlock.dev": [
                                        identity_record("k1")
                                    ],
                                    "gl-abc._groundlock.receipts.groundlock.dev": [
                                        manifest_record()
                                    ],
                                    "c0.gl-abc._groundlock.receipts.groundlock.dev": chunk_values,
                                },
                                "status": active_status_records(),
                            }
                        ),
                        encoding="utf-8",
                    )

                    result = hn_readiness.check_dns_fixture(
                        str(fixture), "receipts.groundlock.dev", "sha256:abc"
                    )

                self.assertFalse(result.ok)
                self.assertIn("chunk TXT", result.detail)
                self.assertIn(expected_detail, result.detail)

    def test_dns_fixture_preflight_rejects_payload_hash_mismatch(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1")
                            ],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                manifest_record(payload="other-payload")
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                "gdc1 i=0 d=abc"
                            ],
                        },
                        "status": active_status_records(),
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("payload hash", result.detail)

    def test_dns_fixture_preflight_rejects_malformed_cached_receipt_payload(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1")
                            ],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                manifest_record(payload="abc")
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                "gdc1 i=0 d=abc"
                            ],
                        },
                        "status": active_status_records(),
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("receipt JSON", result.detail)

    def test_dns_fixture_preflight_rejects_cached_receipt_mismatches(
        self,
    ) -> None:
        cases = [
            (
                cached_receipt_parts(signer_domain="other.groundlock.dev"),
                "fixture cached receipt signer",
                {},
            ),
            (
                cached_receipt_parts(content_hash="sha256:other"),
                "demo hash",
                {},
            ),
            (
                cached_receipt_parts(),
                "body hash",
                {"receipt_hash": "other-receipt"},
            ),
        ]
        for parts, expected_detail, manifest_overrides in cases:
            with self.subTest(expected_detail=expected_detail):
                receipt_hash = str(
                    manifest_overrides.get("receipt_hash", parts["receipt_hash"])
                )
                with tempfile.TemporaryDirectory() as tmp:
                    fixture = Path(tmp) / "dns-fixture.json"
                    fixture.write_text(
                        json.dumps(
                            {
                                "domain": "receipts.groundlock.dev",
                                "txt": {
                                    "_truename.receipts.groundlock.dev": [
                                        identity_record("k1")
                                    ],
                                    "gl-abc._groundlock.receipts.groundlock.dev": [
                                        manifest_record(
                                            receipt_hash=receipt_hash.removeprefix(
                                                "sha256:"
                                            ),
                                            payload=str(parts["payload"]),
                                        )
                                    ],
                                    "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                        chunk_record(parts)
                                    ],
                                },
                                "status": active_status_records(
                                    receipt_hash=(
                                        receipt_hash
                                        if receipt_hash.startswith("sha256:")
                                        else f"sha256:{receipt_hash}"
                                    )
                                ),
                            }
                        ),
                        encoding="utf-8",
                    )

                    result = hn_readiness.check_dns_fixture(
                        str(fixture), "receipts.groundlock.dev", "sha256:abc"
                    )

                self.assertFalse(result.ok)
                self.assertIn(expected_detail, result.detail)

    def test_dns_fixture_preflight_rejects_malformed_status_record_shape(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            parts = cached_receipt_parts()
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1")
                            ],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                manifest_record_for_parts(parts)
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                chunk_record(parts)
                            ],
                        },
                        "status": {
                            "key": {
                                "version": "groundlock-status/v1",
                                "kind": "key",
                                "subject": {
                                    "signerDomain": "receipts.groundlock.dev",
                                    "kid": "k1",
                                },
                                "status": "active",
                            },
                            "claim": {
                                "version": "groundlock-status/v1",
                                "kind": "claim",
                                "subject": {"receiptHash": str(parts["receipt_hash"])},
                                "status": "active",
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("key status record is malformed", result.detail)
        self.assertIn("claim status record is malformed", result.detail)

    def test_dns_fixture_preflight_rejects_malformed_identity_record(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            parts = cached_receipt_parts()
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": ["glt1 kid=k1"],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                manifest_record_for_parts(parts)
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                chunk_record(parts)
                            ],
                        },
                        "status": active_status_for_parts(parts),
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("identity TXT", result.detail)
        self.assertIn("malformed", result.detail)

    def test_dns_fixture_preflight_rejects_ambiguous_identity_record(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            parts = cached_receipt_parts()
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1", "abc"),
                                identity_record("k1", "def"),
                            ],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                manifest_record_for_parts(parts)
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                chunk_record(parts)
                            ],
                        },
                        "status": active_status_for_parts(parts),
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("identity TXT", result.detail)
        self.assertIn("ambiguous", result.detail)

    def test_dns_fixture_preflight_rejects_identity_for_wrong_manifest_key(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            parts = cached_receipt_parts()
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("other-key")
                            ],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                manifest_record_for_parts(parts)
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                chunk_record(parts)
                            ],
                        },
                        "status": active_status_for_parts(parts),
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("identity TXT", result.detail)
        self.assertIn("manifest key", result.detail)

    def test_dns_fixture_preflight_rejects_manifest_for_wrong_signer_domain(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            parts = cached_receipt_parts(signer_domain="other.groundlock.dev")
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1")
                            ],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                manifest_record_for_parts(
                                    parts, signer_domain="other.groundlock.dev"
                                )
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                chunk_record(parts)
                            ],
                        },
                        "status": active_status_for_parts(
                            parts, signer_domain="other.groundlock.dev"
                        ),
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("signer domain", result.detail)
        self.assertIn("launch domain", result.detail)

    def test_dns_fixture_preflight_rejects_wrong_domain_or_missing_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "other.groundlock.dev",
                        "txt": {
                            "_truename.other.groundlock.dev": [identity_record("k1")],
                        },
                        "status": {
                            "key": {
                                "version": "groundlock-status/v1",
                                "kind": "key",
                                "subject": {
                                    "signerDomain": "other.groundlock.dev",
                                    "kid": "k1",
                                },
                                "status": "active",
                                "issuedAt": ISSUED_AT,
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("domain", result.detail)
        self.assertIn("claim", result.detail)

    def test_dns_fixture_preflight_rejects_fixture_for_different_demo_hash(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1")
                            ],
                            "gl-other._groundlock.receipts.groundlock.dev": [
                                "gdm1 rh=abc ph=def n=1 key=receipts.groundlock.dev#k1"
                            ],
                            "c0.gl-other._groundlock.receipts.groundlock.dev": [
                                "gdc1 i=0 d=abc"
                            ],
                        },
                        "status": {
                            "key": {
                                "version": "groundlock-status/v1",
                                "kind": "key",
                                "subject": {
                                    "signerDomain": "receipts.groundlock.dev",
                                    "kid": "k1",
                                },
                                "status": "active",
                                "issuedAt": ISSUED_AT,
                            },
                            "claim": {
                                "version": "groundlock-status/v1",
                                "kind": "claim",
                                "subject": {"receiptHash": "sha256:abc"},
                                "status": "active",
                                "issuedAt": ISSUED_AT,
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("demo hash", result.detail)

    def test_dns_fixture_preflight_rejects_status_records_for_wrong_manifest(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            parts = cached_receipt_parts()
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1")
                            ],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                manifest_record_for_parts(parts)
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                chunk_record(parts)
                            ],
                        },
                        "status": {
                            "key": {
                                "version": "groundlock-status/v1",
                                "kind": "key",
                                "subject": {
                                    "signerDomain": "receipts.groundlock.dev",
                                    "kid": "other-key",
                                },
                                "status": "active",
                                "issuedAt": ISSUED_AT,
                            },
                            "claim": {
                                "version": "groundlock-status/v1",
                                "kind": "claim",
                                "subject": {"receiptHash": "sha256:other-receipt"},
                                "status": "active",
                                "issuedAt": ISSUED_AT,
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("key status", result.detail)
        self.assertIn("claim status", result.detail)

    def test_dns_fixture_preflight_rejects_missing_declared_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1")
                            ],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                manifest_record(chunk_count=2)
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                "gdc1 i=0 d=abc"
                            ],
                        },
                        "status": {
                            "key": {
                                "version": "groundlock-status/v1",
                                "kind": "key",
                                "subject": {
                                    "signerDomain": "receipts.groundlock.dev",
                                    "kid": "k1",
                                },
                                "status": "active",
                                "issuedAt": ISSUED_AT,
                            },
                            "claim": {
                                "version": "groundlock-status/v1",
                                "kind": "claim",
                                "subject": {"receiptHash": "sha256:abc"},
                                "status": "active",
                                "issuedAt": ISSUED_AT,
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", "sha256:abc"
            )

        self.assertFalse(result.ok)
        self.assertIn("c1", result.detail)

    def test_dns_fixture_preflight_hashes_file_input_with_groundlock_canonicalization(
        self,
    ) -> None:
        content_hash = hn_readiness.digest_text("Pay Jane Roe $2,000.00.")
        manifest_label = hn_readiness.cache_label(content_hash)
        parts = cached_receipt_parts(content_hash=content_hash)
        with tempfile.TemporaryDirectory() as tmp:
            sample = Path(tmp) / "notice.txt"
            sample.write_text("Pay Jane Roe $2,000.00.", encoding="utf-8")
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": [
                                identity_record("k1")
                            ],
                            f"gl-{manifest_label}._groundlock.receipts.groundlock.dev": [
                                manifest_record_for_parts(parts)
                            ],
                            f"c0.gl-{manifest_label}._groundlock.receipts.groundlock.dev": [
                                chunk_record(parts)
                            ],
                        },
                        "status": active_status_for_parts(parts),
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev", str(sample)
            )

        self.assertTrue(result.ok)

    def test_homepage_metadata_accepts_public_launch_origin(self) -> None:
        html = """
        <html>
          <head>
            <title>GroundLock Receipts</title>
            <link rel="canonical" href="https://receipts.groundlock.dev/">
            <meta property="og:title" content="GroundLock Receipts">
            <meta property="og:url" content="https://receipts.groundlock.dev/">
            <meta property="og:image" content="https://receipts.groundlock.dev/groundlock-receipt-desk.png">
            <meta name="twitter:image" content="https://receipts.groundlock.dev/groundlock-receipt-desk.png">
          </head>
        </html>
        """

        result = hn_readiness.validate_homepage_metadata(
            html, "https://receipts.groundlock.dev/api/health"
        )

        self.assertTrue(result.ok)
        self.assertEqual(result.name, "metadata")

    def test_homepage_metadata_accepts_root_urls_without_trailing_slash(self) -> None:
        html = """
        <html>
          <head>
            <title>GroundLock Receipts</title>
            <link rel="canonical" href="https://receipts.groundlock.dev">
            <meta property="og:title" content="GroundLock Receipts">
            <meta property="og:url" content="https://receipts.groundlock.dev">
            <meta property="og:image" content="https://receipts.groundlock.dev/groundlock-receipt-desk.png">
            <meta name="twitter:image" content="https://receipts.groundlock.dev/groundlock-receipt-desk.png">
          </head>
        </html>
        """

        result = hn_readiness.validate_homepage_metadata(
            html, "https://receipts.groundlock.dev/"
        )

        self.assertTrue(result.ok)

    def test_homepage_metadata_rejects_stale_localhost_urls(self) -> None:
        html = """
        <html>
          <head>
            <title>GroundLock Receipts</title>
            <link rel="canonical" href="http://localhost:3000/">
            <meta property="og:title" content="GroundLock Receipts">
            <meta property="og:url" content="http://localhost:3000/">
            <meta property="og:image" content="http://localhost:3000/groundlock-receipt-desk.png">
            <meta name="twitter:image" content="http://localhost:3000/groundlock-receipt-desk.png">
          </head>
        </html>
        """

        result = hn_readiness.validate_homepage_metadata(
            html, "https://receipts.groundlock.dev/"
        )

        self.assertFalse(result.ok)
        self.assertIn("canonical", result.detail)
        self.assertIn("og:url", result.detail)
        self.assertIn("localhost", result.detail)

    def test_homepage_metadata_requires_groundlock_title(self) -> None:
        html = """
        <html>
          <head>
            <link rel="canonical" href="https://receipts.groundlock.dev/">
            <meta property="og:url" content="https://receipts.groundlock.dev/">
            <meta property="og:image" content="https://receipts.groundlock.dev/groundlock-receipt-desk.png">
            <meta name="twitter:image" content="https://receipts.groundlock.dev/groundlock-receipt-desk.png">
          </head>
        </html>
        """

        result = hn_readiness.validate_homepage_metadata(
            html, "https://receipts.groundlock.dev/"
        )

        self.assertFalse(result.ok)
        self.assertIn("GroundLock Receipts", result.detail)

    def test_launch_kit_check_accepts_matching_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev/api/health",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertTrue(result.ok)
        self.assertEqual(result.name, "launch-kit")
        self.assertIn("checksum manifest", result.detail)

    def test_launch_kit_check_fails_when_artifact_is_tampered(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            (kit / "runbook.md").write_text("changed\n", encoding="utf-8")
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn("artifactSha256.runbook does not match runbook.md", result.detail)
        self.assertIn("checksums.txt digest does not match runbook.md", result.detail)

    def test_launch_kit_check_fails_when_summary_contains_private_jwk(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            summary_path = kit / "launch-summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            summary["debugSigningKey"] = {
                "crv": "Ed25519",
                "d": "private-material",
                "kty": "OKP",
                "x": "public-material",
            }
            summary_path.write_text(
                json.dumps(summary, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn(
            "launch-summary.json contains private JWK material", result.detail
        )

    def test_launch_kit_check_fails_when_public_artifact_embeds_private_jwk_string(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            runbook_path = kit / "runbook.md"
            runbook = runbook_path.read_text(encoding="utf-8")
            runbook_path.write_text(
                runbook
                + '\nDebug key: {"d":"private-material","kty":"OKP","x":"public-material"}\n',
                encoding="utf-8",
            )
            refresh_launch_kit_hashes(kit)
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn("runbook.md contains private JWK material", result.detail)

    def test_launch_kit_check_fails_when_hn_readiness_script_uses_wrong_input(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            script_path = kit / "hn-readiness.ps1"
            script = script_path.read_text(encoding="utf-8")
            script_path.write_text(
                script.replace(
                    '--doh-endpoint "https://resolver.groundlock.dev/dns-query"',
                    '--doh-endpoint "https://other.groundlock.dev/dns-query"',
                ),
                encoding="utf-8",
            )
            refresh_launch_kit_hashes(kit)
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn("hn-readiness.ps1 is missing", result.detail)
        self.assertIn("--doh-endpoint", result.detail)

    def test_launch_kit_check_fails_when_runbook_uses_wrong_input(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            runbook_path = kit / "runbook.md"
            runbook = runbook_path.read_text(encoding="utf-8")
            runbook_path.write_text(
                runbook.replace(
                    '--domain "receipts.groundlock.dev"',
                    '--domain "other.groundlock.dev"',
                ),
                encoding="utf-8",
            )
            refresh_launch_kit_hashes(kit)
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn("runbook.md is missing", result.detail)
        self.assertIn("--domain", result.detail)

    def test_launch_kit_check_fails_when_summary_receipt_metadata_differs(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            summary_path = kit / "launch-summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            summary["receiptHash"] = "sha256:other"
            summary["signerKeyId"] = "other"
            summary_path.write_text(
                json.dumps(summary, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn("receiptHash does not match DNS fixture", result.detail)
        self.assertIn("signerKeyId does not match DNS fixture", result.detail)

    def test_launch_kit_check_fails_when_summary_receipt_fields_differ(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            summary_path = kit / "launch-summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            summary["receiptVerdict"] = "block"
            summary["receiptIssuedAt"] = "2026-06-09T00:00:00.000Z"
            summary["contentClass"] = "other"
            summary_path.write_text(
                json.dumps(summary, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn("receiptVerdict does not match DNS fixture", result.detail)
        self.assertIn("receiptIssuedAt does not match DNS fixture", result.detail)
        self.assertIn("contentClass does not match DNS fixture", result.detail)

    def test_launch_kit_check_fails_when_summary_dns_txt_count_differs(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            summary_path = kit / "launch-summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            summary["dnsTxtRecordCount"] = 999
            summary_path.write_text(
                json.dumps(summary, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn(
            "dnsTxtRecordCount does not match DNS fixture",
            result.detail,
        )

    def test_launch_kit_check_fails_when_status_records_differ_from_fixture(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            status_records_path = kit / "status-records.json"
            records = json.loads(status_records_path.read_text(encoding="utf-8"))
            records[1]["status"] = "retracted"
            status_records_path.write_text(
                json.dumps(records, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            refresh_launch_kit_hashes(kit)
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn(
            "status-records.json does not match DNS fixture status records",
            result.detail,
        )

    def test_launch_kit_check_fails_when_web_env_differs_from_fixture(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            web_env_path = kit / "web.env"
            lines = web_env_path.read_text(encoding="utf-8").splitlines()
            updated = [
                (
                    "GROUNDLOCK_STATUS_RECORDS_JSON=[]"
                    if line.startswith("GROUNDLOCK_STATUS_RECORDS_JSON=")
                    else line
                )
                for line in lines
            ]
            web_env_path.write_text("\n".join(updated) + "\n", encoding="utf-8")
            refresh_launch_kit_hashes(kit)
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn(
            "web.env status records JSON does not match DNS fixture status records",
            result.detail,
        )

    def test_launch_kit_check_fails_when_web_env_fetch_timeout_is_invalid(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            web_env_path = kit / "web.env"
            lines = web_env_path.read_text(encoding="utf-8").splitlines()
            updated = [
                (
                    "GROUNDLOCK_FETCH_TIMEOUT_MS=0"
                    if line.startswith("GROUNDLOCK_FETCH_TIMEOUT_MS=")
                    else line
                )
                for line in lines
            ]
            web_env_path.write_text("\n".join(updated) + "\n", encoding="utf-8")
            refresh_launch_kit_hashes(kit)
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn("web.env fetch timeout", result.detail)

    def test_launch_kit_check_fails_when_summary_fetch_timeout_is_not_integer(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            summary_path = kit / "launch-summary.json"
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
            summary["fetchTimeoutMs"] = True
            summary_path.write_text(
                json.dumps(summary, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn("launch summary fetchTimeoutMs is missing", result.detail)

    def test_launch_kit_check_fails_when_web_env_fetch_timeout_differs_from_summary(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            web_env_path = kit / "web.env"
            lines = web_env_path.read_text(encoding="utf-8").splitlines()
            updated = [
                (
                    "GROUNDLOCK_FETCH_TIMEOUT_MS=8000"
                    if line.startswith("GROUNDLOCK_FETCH_TIMEOUT_MS=")
                    else line
                )
                for line in lines
            ]
            web_env_path.write_text("\n".join(updated) + "\n", encoding="utf-8")
            refresh_launch_kit_hashes(kit)
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn(
            "web.env fetch timeout does not match launch summary",
            result.detail,
        )

    def test_launch_kit_check_fails_when_dns_zone_differs_from_fixture(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            dns_zone_path = kit / "dns-zone.txt"
            zone = dns_zone_path.read_text(encoding="utf-8")
            dns_zone_path.write_text(
                zone.replace("gdm1 ", "gdm1 tampered=1 ", 1),
                encoding="utf-8",
            )
            refresh_launch_kit_hashes(kit)
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(kit / "dns-fixture.json"),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn("dns-zone.txt values do not match", result.detail)

    def test_launch_kit_check_fails_when_fixture_copy_differs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            kit = write_launch_kit(Path(tmp))
            other_fixture = Path(tmp) / "dns-fixture.json"
            other_fixture.write_text('{"domain":"other"}\n', encoding="utf-8")
            args = SimpleNamespace(
                health_url="https://receipts.groundlock.dev",
                status_base_url="https://receipts.groundlock.dev/groundlock/status",
                doh_endpoint="https://resolver.groundlock.dev/dns-query",
                domain="receipts.groundlock.dev",
                dns_fixture=str(other_fixture),
                file_or_hash="sha256:abc123",
            )

            result = hn_readiness.check_launch_kit(str(kit), args)

        self.assertFalse(result.ok)
        self.assertIn(
            "launch kit dns-fixture.json does not match readiness fixture",
            result.detail,
        )

    def test_run_checks_stops_before_external_checks_when_preflight_fails(self) -> None:
        args = SimpleNamespace(
            health_url="http://localhost:3000",
            status_base_url="https://publisher.example/groundlock/status",
            doh_endpoint=None,
            domain="publisher.example",
            show_hn_draft="ignored.md",
            repo="ucsandman/groundlock-receipts",
            branch="main",
            dns_fixture="published/dns-fixture.json",
            file_or_hash="sha256:abc123",
        )

        ok = hn_readiness.CheckResult("mock", True, "ok")
        with (
            mock.patch.object(hn_readiness, "check_git_clean", return_value=ok),
            mock.patch.object(hn_readiness, "check_show_hn_draft", return_value=ok),
            mock.patch.object(hn_readiness, "check_dns_fixture", return_value=ok),
            mock.patch.object(
                hn_readiness,
                "check_ci",
                side_effect=AssertionError("external checks should not run"),
            ),
        ):
            results = hn_readiness.run_checks(args)

        self.assertEqual(
            [result.name for result in results],
            ["mock", "mock", "launch-targets", "mock"],
        )
        self.assertFalse(results[2].ok)

    def test_run_checks_stops_before_external_checks_when_dns_fixture_fails(
        self,
    ) -> None:
        args = SimpleNamespace(
            health_url="https://receipts.groundlock.dev",
            status_base_url="https://receipts.groundlock.dev/groundlock/status",
            doh_endpoint="https://resolver.groundlock.dev/dns-query",
            domain="receipts.groundlock.dev",
            show_hn_draft="ignored.md",
            repo="ucsandman/groundlock-receipts",
            branch="main",
            dns_fixture="missing.json",
            file_or_hash="sha256:abc123",
        )

        ok = hn_readiness.CheckResult("mock", True, "ok")
        fixture_fail = hn_readiness.CheckResult("dns-fixture", False, "missing")
        with (
            mock.patch.object(hn_readiness, "check_git_clean", return_value=ok),
            mock.patch.object(hn_readiness, "check_show_hn_draft", return_value=ok),
            mock.patch.object(
                hn_readiness, "check_dns_fixture", return_value=fixture_fail
            ),
            mock.patch.object(
                hn_readiness,
                "check_ci",
                side_effect=AssertionError("external checks should not run"),
            ),
        ):
            results = hn_readiness.run_checks(args)

        self.assertEqual(results[-1].name, "dns-fixture")
        self.assertFalse(results[-1].ok)

    def test_run_checks_stops_before_external_checks_when_launch_kit_fails(
        self,
    ) -> None:
        args = SimpleNamespace(
            health_url="https://receipts.groundlock.dev",
            status_base_url="https://receipts.groundlock.dev/groundlock/status",
            doh_endpoint="https://resolver.groundlock.dev/dns-query",
            domain="receipts.groundlock.dev",
            show_hn_draft="ignored.md",
            repo="ucsandman/groundlock-receipts",
            branch="main",
            dns_fixture="published/launch-kit/dns-fixture.json",
            launch_kit="published/launch-kit",
            file_or_hash="sha256:abc123",
        )

        ok = hn_readiness.CheckResult("mock", True, "ok")
        launch_kit_fail = hn_readiness.CheckResult(
            "launch-kit", False, "checksum mismatch"
        )
        with (
            mock.patch.object(hn_readiness, "check_git_clean", return_value=ok),
            mock.patch.object(hn_readiness, "check_show_hn_draft", return_value=ok),
            mock.patch.object(hn_readiness, "check_dns_fixture", return_value=ok),
            mock.patch.object(
                hn_readiness, "check_launch_kit", return_value=launch_kit_fail
            ) as check_launch_kit,
            mock.patch.object(
                hn_readiness,
                "check_ci",
                side_effect=AssertionError("external checks should not run"),
            ),
        ):
            results = hn_readiness.run_checks(args)

        self.assertEqual(results[-1].name, "launch-kit")
        self.assertFalse(results[-1].ok)
        check_launch_kit.assert_called_once_with("published/launch-kit", args)

    def test_run_checks_includes_deployed_web_verify_after_preflight(self) -> None:
        args = SimpleNamespace(
            health_url="https://receipts.groundlock.dev",
            status_base_url="https://receipts.groundlock.dev/groundlock/status",
            doh_endpoint="https://resolver.groundlock.dev/dns-query",
            domain="receipts.groundlock.dev",
            show_hn_draft="ignored.md",
            repo="ucsandman/groundlock-receipts",
            branch="main",
            dns_fixture="published/dns-fixture.json",
            launch_kit="published/launch-kit",
            file_or_hash="sha256:abc123",
        )

        ok = hn_readiness.CheckResult("mock", True, "ok")
        web_verify = hn_readiness.CheckResult("web-verify", True, "ok")
        fixture_manifest = hn_readiness.FixtureManifest(
            receipt_hash="sha256:receipt",
            payload_hash="sha256:payload",
            signer_domain="receipts.groundlock.dev",
            kid="k1",
            chunk_count=1,
        )
        with (
            mock.patch.object(hn_readiness, "check_git_clean", return_value=ok),
            mock.patch.object(hn_readiness, "check_show_hn_draft", return_value=ok),
            mock.patch.object(hn_readiness, "check_dns_fixture", return_value=ok),
            mock.patch.object(hn_readiness, "check_launch_kit", return_value=ok),
            mock.patch.object(
                hn_readiness,
                "fixture_manifest_for_input",
                return_value=fixture_manifest,
            ),
            mock.patch.object(hn_readiness, "check_ci", return_value=ok),
            mock.patch.object(hn_readiness, "check_health_url", return_value=ok),
            mock.patch.object(hn_readiness, "check_homepage_metadata", return_value=ok),
            mock.patch.object(
                hn_readiness, "check_security_headers", return_value=ok
            ) as check_security_headers,
            mock.patch.object(hn_readiness, "check_warm_cache", return_value=ok),
            mock.patch.object(hn_readiness, "check_live_receipt", return_value=ok),
            mock.patch.object(
                hn_readiness, "check_web_verify", return_value=web_verify
            ) as check_web_verify,
        ):
            results = hn_readiness.run_checks(args)

        self.assertIn("web-verify", [result.name for result in results])
        self.assertEqual(results[-1].name, "web-verify")
        check_security_headers.assert_called_once_with(
            "https://receipts.groundlock.dev"
        )
        check_web_verify.assert_called_once_with(
            "https://receipts.groundlock.dev",
            "sha256:abc123",
            "receipts.groundlock.dev",
            "sha256:receipt",
        )

    def test_builds_machine_readable_evidence_report(self) -> None:
        args = SimpleNamespace(
            health_url="https://receipts.groundlock.dev/api/health",
            status_base_url="https://receipts.groundlock.dev/groundlock/status",
            doh_endpoint="https://resolver.groundlock.dev/dns-query",
            domain="receipts.groundlock.dev",
            show_hn_draft="docs/show-hn-draft.md",
            repo="ucsandman/groundlock-receipts",
            branch="main",
            dns_fixture="published/dns-fixture.json",
            launch_kit="published/launch-kit",
            file_or_hash="sha256:abc123",
        )
        results = [
            hn_readiness.CheckResult("git", True, "worktree clean"),
            hn_readiness.CheckResult("health", True, "ready"),
        ]

        with mock.patch.object(hn_readiness, "current_git_head", return_value="abc"):
            report = hn_readiness.build_evidence_report(args, results)

        self.assertEqual(report["schema"], "groundlock-hn-readiness-evidence/v1")
        self.assertTrue(report["ok"])
        self.assertEqual(report["gitHead"], "abc")
        self.assertEqual(
            report["inputs"],
            {
                "healthUrl": "https://receipts.groundlock.dev/api/health",
                "homepageUrl": "https://receipts.groundlock.dev/",
                "verifyEndpoint": "https://receipts.groundlock.dev/api/verify",
                "dnsFixture": "published/dns-fixture.json",
                "fileOrHash": "sha256:abc123",
                "domain": "receipts.groundlock.dev",
                "statusBaseUrl": "https://receipts.groundlock.dev/groundlock/status",
                "dohEndpoint": "https://resolver.groundlock.dev/dns-query",
                "repo": "ucsandman/groundlock-receipts",
                "branch": "main",
                "showHnDraft": "docs/show-hn-draft.md",
                "launchKit": "published/launch-kit",
            },
        )
        self.assertEqual(report["checks"][0]["name"], "git")
        self.assertTrue(
            str(report["securityHeaderContract"]["sha256"]).startswith("sha256:")
        )

    def test_evidence_report_write_failure_fails_closed(self) -> None:
        args = SimpleNamespace(
            health_url="https://receipts.groundlock.dev",
            status_base_url="https://receipts.groundlock.dev/groundlock/status",
            doh_endpoint="https://resolver.groundlock.dev/dns-query",
            domain="receipts.groundlock.dev",
            show_hn_draft="docs/show-hn-draft.md",
            repo="ucsandman/groundlock-receipts",
            branch="main",
            dns_fixture="published/dns-fixture.json",
            file_or_hash="sha256:abc123",
        )
        with tempfile.TemporaryDirectory() as tmp:
            result = hn_readiness.write_evidence_report(
                tmp, args, [hn_readiness.CheckResult("mock", True, "ok")]
            )

        self.assertFalse(result.ok)
        self.assertEqual(result.name, "evidence")

    def test_main_writes_optional_evidence_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            evidence_path = Path(tmp) / "hn-readiness-evidence.json"
            ok = hn_readiness.CheckResult("mock", True, "ok")
            argv = [
                "--health-url",
                "https://receipts.groundlock.dev",
                "--status-base-url",
                "https://receipts.groundlock.dev/groundlock/status",
                "--doh-endpoint",
                "https://resolver.groundlock.dev/dns-query",
                "--domain",
                "receipts.groundlock.dev",
                "--show-hn-draft",
                "docs/show-hn-draft.md",
                "--repo",
                "ucsandman/groundlock-receipts",
                "--branch",
                "main",
                "--dns-fixture",
                "published/dns-fixture.json",
                "--file-or-hash",
                "sha256:abc123",
                "--evidence-out",
                str(evidence_path),
            ]

            with (
                mock.patch.object(hn_readiness, "run_checks", return_value=[ok]),
                mock.patch.object(hn_readiness, "current_git_head", return_value="abc"),
            ):
                with contextlib.redirect_stdout(io.StringIO()):
                    code = hn_readiness.main(argv)

            report = json.loads(evidence_path.read_text(encoding="utf-8"))

        self.assertEqual(code, 0)
        self.assertTrue(report["ok"])
        self.assertEqual(report["checks"][0]["name"], "mock")
        self.assertEqual(report["gitHead"], "abc")

    def test_builds_local_check_live_command_without_shell(self) -> None:
        argv = hn_readiness.build_check_live_argv(
            file_or_hash="sha256:abc123",
            domain="publisher.example",
            status_base_url="https://publisher.example/groundlock/status",
            doh_endpoint="https://resolver.example/dns-query",
        )

        self.assertEqual(argv[0:3], ["node", str(hn_readiness.CLI_PATH), "check-live"])
        self.assertIn("sha256:abc123", argv)
        self.assertIn("--domain", argv)
        self.assertIn("publisher.example", argv)
        self.assertIn("--status-base-url", argv)
        self.assertIn("https://publisher.example/groundlock/status", argv)
        self.assertIn("--doh-endpoint", argv)
        self.assertIn("https://resolver.example/dns-query", argv)

    def test_builds_local_warm_cache_command_without_shell(self) -> None:
        argv = hn_readiness.build_warm_cache_argv(
            dns_fixture="published/dns-fixture.json",
            doh_endpoint="https://resolver.example/dns-query",
        )

        self.assertEqual(argv[0:3], ["node", str(hn_readiness.CLI_PATH), "warm-cache"])
        self.assertIn("published/dns-fixture.json", argv)
        self.assertIn("--doh-endpoint", argv)
        self.assertIn("https://resolver.example/dns-query", argv)

    def test_ci_check_rejects_successful_run_for_older_commit(self) -> None:
        result = hn_readiness.validate_ci_runs(
            [
                {
                    "status": "completed",
                    "conclusion": "success",
                    "databaseId": 123,
                    "headSha": "older",
                }
            ],
            expected_head_sha="current",
        )

        self.assertFalse(result.ok)
        self.assertIn("current", result.detail)
        self.assertIn("older", result.detail)

    def test_ci_check_accepts_successful_run_for_current_commit(self) -> None:
        result = hn_readiness.validate_ci_runs(
            [
                {
                    "status": "completed",
                    "conclusion": "success",
                    "databaseId": 123,
                    "headSha": "current",
                }
            ],
            expected_head_sha="current",
        )

        self.assertTrue(result.ok)


if __name__ == "__main__":
    unittest.main()
