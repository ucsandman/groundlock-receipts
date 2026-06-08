import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from scripts import hn_readiness


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
        ok = hn_readiness.validate_web_verify_body(
            json.dumps({"state": "PASS", "code": "verified"})
        )
        bad = hn_readiness.validate_web_verify_body(
            json.dumps({"state": "UNVERIFIABLE", "code": "dns_txt_missing"})
        )

        self.assertTrue(ok.ok)
        self.assertEqual(ok.name, "web-verify")
        self.assertFalse(bad.ok)
        self.assertIn("UNVERIFIABLE", bad.detail)

    def test_dns_fixture_preflight_accepts_launch_domain_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "receipts.groundlock.dev",
                        "txt": {
                            "_truename.receipts.groundlock.dev": ["glt1 kid=k1"],
                            "gl-abc._groundlock.receipts.groundlock.dev": [
                                "gdm1 rh=abc ph=def n=1 key=receipts.groundlock.dev#k1"
                            ],
                            "c0.gl-abc._groundlock.receipts.groundlock.dev": [
                                "gdc1 i=0 d=abc"
                            ],
                        },
                        "status": {
                            "key": {
                                "version": "groundlock-status/v1",
                                "kind": "key",
                            },
                            "claim": {
                                "version": "groundlock-status/v1",
                                "kind": "claim",
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev"
            )

        self.assertTrue(result.ok)
        self.assertEqual(result.name, "dns-fixture")

    def test_dns_fixture_preflight_rejects_wrong_domain_or_missing_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            fixture = Path(tmp) / "dns-fixture.json"
            fixture.write_text(
                json.dumps(
                    {
                        "domain": "other.groundlock.dev",
                        "txt": {
                            "_truename.other.groundlock.dev": ["glt1 kid=k1"],
                        },
                        "status": {
                            "key": {
                                "version": "groundlock-status/v1",
                                "kind": "key",
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            result = hn_readiness.check_dns_fixture(
                str(fixture), "receipts.groundlock.dev"
            )

        self.assertFalse(result.ok)
        self.assertIn("domain", result.detail)
        self.assertIn("claim", result.detail)

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
            file_or_hash="sha256:abc123",
        )

        ok = hn_readiness.CheckResult("mock", True, "ok")
        web_verify = hn_readiness.CheckResult("web-verify", True, "ok")
        with (
            mock.patch.object(hn_readiness, "check_git_clean", return_value=ok),
            mock.patch.object(hn_readiness, "check_show_hn_draft", return_value=ok),
            mock.patch.object(hn_readiness, "check_dns_fixture", return_value=ok),
            mock.patch.object(hn_readiness, "check_ci", return_value=ok),
            mock.patch.object(hn_readiness, "check_health_url", return_value=ok),
            mock.patch.object(hn_readiness, "check_homepage_metadata", return_value=ok),
            mock.patch.object(hn_readiness, "check_warm_cache", return_value=ok),
            mock.patch.object(hn_readiness, "check_live_receipt", return_value=ok),
            mock.patch.object(
                hn_readiness, "check_web_verify", return_value=web_verify
            ),
        ):
            results = hn_readiness.run_checks(args)

        self.assertIn("web-verify", [result.name for result in results])
        self.assertEqual(results[-1].name, "web-verify")

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
