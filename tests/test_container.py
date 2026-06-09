import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ContainerConfigTests(unittest.TestCase):
    def test_docker_runtime_is_health_checked_and_non_root(self) -> None:
        dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")

        self.assertFalse(dockerfile.startswith("# syntax="))
        self.assertNotIn("docker/dockerfile", dockerfile)
        self.assertIn("node:24", dockerfile)
        self.assertIn("NEXT_TELEMETRY_DISABLED", dockerfile)
        self.assertIn("ARG NEXT_PUBLIC_SITE_URL", dockerfile)
        self.assertIn("ENV NEXT_PUBLIC_SITE_URL", dockerfile)
        self.assertIn("HEALTHCHECK", dockerfile)
        self.assertIn("/api/health", dockerfile)
        self.assertIn("USER node", dockerfile)
        self.assertIn("server.js", dockerfile)

    def test_dockerignore_excludes_local_and_secret_material(self) -> None:
        dockerignore = (ROOT / ".dockerignore").read_text(encoding="utf-8")

        self.assertIn("node_modules", dockerignore)
        self.assertIn(".next", dockerignore)
        self.assertIn(".env*", dockerignore)
        self.assertIn("!.env.example", dockerignore)
        self.assertIn(".git", dockerignore)

    def test_ci_builds_and_smokes_container_image(self) -> None:
        workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text(
            encoding="utf-8"
        )

        self.assertIn("docker build", workflow)
        self.assertIn(
            "--build-arg NEXT_PUBLIC_SITE_URL=https://receipts.groundlock.dev", workflow
        )
        self.assertIn("docker run", workflow)
        self.assertIn("scripts/smoke_web_response.mjs", workflow)
        self.assertIn("--verify-file-text", workflow)
        self.assertIn("Smoke Docker live mode", workflow)
        self.assertIn("GROUNDLOCK_SIGNER_DOMAIN", workflow)
        self.assertIn("GROUNDLOCK_FETCH_TIMEOUT_MS=5000", workflow)
        self.assertIn("GROUNDLOCK_RATE_LIMIT_MAX=240", workflow)
        self.assertIn("GROUNDLOCK_RATE_LIMIT_WINDOW_MS=60000", workflow)
        self.assertIn("GROUNDLOCK_STATUS_RECORDS_JSON", workflow)
        self.assertIn("--expect-live", workflow)
        self.assertIn("--status-key-lookup", workflow)

    def test_web_response_smoke_checks_security_headers(self) -> None:
        smoke = (ROOT / "scripts" / "smoke_web_response.mjs").read_text(
            encoding="utf-8"
        )
        contract = json.loads(
            (ROOT / "apps" / "web" / "lib" / "security-header-contract.json").read_text(
                encoding="utf-8"
            )
        )

        self.assertIn("security-header-contract.json", smoke)
        self.assertIn("Content-Security-Policy", contract["requiredHeaderValues"])
        self.assertIn("X-Frame-Options", contract["requiredHeaderValues"])
        self.assertIn("Strict-Transport-Security", contract["requiredHeaderValues"])
        self.assertIn("Permissions-Policy", contract["requiredHeaderValues"])
        self.assertIn("unsafe-eval", " ".join(contract["forbiddenCspValues"]))
        self.assertIn("/api/health", smoke)
        self.assertIn("/api/verify", smoke)
        self.assertIn("Cache-Control: no-store", smoke)
        self.assertIn("--expect-live", smoke)
        self.assertIn("--verify-file-text", smoke)
        self.assertIn("statusRecordsConfigured", smoke)
        self.assertIn("/groundlock/status/", smoke)


if __name__ == "__main__":
    unittest.main()
