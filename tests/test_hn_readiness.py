import json
import tempfile
import unittest
from pathlib import Path

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
                        "statusBaseUrlConfigured": True,
                    },
                }
            )
        )

        self.assertTrue(response.ok)

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


if __name__ == "__main__":
    unittest.main()
