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

    def test_homepage_url_strips_health_endpoint(self) -> None:
        self.assertEqual(
            hn_readiness.homepage_url(
                "https://receipts.groundlock.dev/api/health?check=true"
            ),
            "https://receipts.groundlock.dev/",
        )

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
            mock.patch.object(
                hn_readiness,
                "check_ci",
                side_effect=AssertionError("external checks should not run"),
            ),
        ):
            results = hn_readiness.run_checks(args)

        self.assertEqual(
            [result.name for result in results], ["mock", "mock", "launch-targets"]
        )
        self.assertFalse(results[-1].ok)

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
