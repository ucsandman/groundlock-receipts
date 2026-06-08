import json
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parents[1]
SMOKE_SCRIPT = ROOT / "scripts" / "smoke_web_response.mjs"
CONTRACT = json.loads(
    (ROOT / "apps" / "web" / "lib" / "security-header-contract.json").read_text(
        encoding="utf-8"
    )
)


def security_headers() -> dict[str, str]:
    return {
        name: "; ".join(values)
        for name, values in CONTRACT["requiredHeaderValues"].items()
    }


def homepage_html(origin: str) -> str:
    return f"""
    <html>
      <head>
        <link rel="canonical" href="{origin}/">
        <meta property="og:url" content="{origin}/">
        <meta property="og:image" content="{origin}/groundlock-receipt-desk.png">
        <meta name="twitter:image" content="{origin}/groundlock-receipt-desk.png">
      </head>
      <body>GroundLock Receipts</body>
    </html>
    """


def live_health(*, status_records_configured: bool = True) -> dict[str, object]:
    return {
        "service": "groundlock-web",
        "ok": True,
        "mode": "live",
        "checks": {
            "signerDomainConfigured": True,
            "siteUrlConfigured": True,
            "dohEndpointConfigured": True,
            "statusBaseUrlConfigured": True,
            "statusRecordsConfigured": status_records_configured,
        },
    }


def status_record(kind: str) -> dict[str, object]:
    if kind == "key":
        return {
            "version": "groundlock-status/v1",
            "kind": "key",
            "subject": {"signerDomain": "publisher.example", "kid": "k1"},
            "status": "active",
            "issuedAt": "2026-06-08T00:00:00.000Z",
        }
    return {
        "version": "groundlock-status/v1",
        "kind": "claim",
        "subject": {"receiptHash": "sha256:abc123"},
        "status": "active",
        "issuedAt": "2026-06-08T00:00:00.000Z",
    }


class SmokeFixture:
    def __init__(
        self,
        *,
        homepage_origin: str = "https://receipts.groundlock.dev",
        status_records_configured: bool = True,
    ) -> None:
        self.homepage_origin = homepage_origin
        self.status_records_configured = status_records_configured


class SmokeHandler(BaseHTTPRequestHandler):
    server: "SmokeServer"

    def do_GET(self) -> None:  # noqa: vulture
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_text(homepage_html(self.server.fixture.homepage_origin))
            return
        if parsed.path == "/api/health":
            self.send_json(
                live_health(
                    status_records_configured=(
                        self.server.fixture.status_records_configured
                    )
                ),
                no_store=True,
            )
            return
        if parsed.path == "/groundlock/status/key":
            self.send_status_record(parsed.query, "key", "key:publisher.example:k1")
            return
        if parsed.path == "/groundlock/status/claim":
            self.send_status_record(parsed.query, "claim", "claim:sha256:abc123")
            return
        self.send_response(404)
        self.end_headers()

    def send_status_record(self, query: str, kind: str, expected_lookup: str) -> None:
        lookup = parse_qs(query).get("lookup", [""])[0]
        if lookup != expected_lookup:
            self.send_response(404)
            self.end_headers()
            return
        self.send_json(status_record(kind), no_store=True)

    def send_text(self, body: str) -> None:
        self.send_response(200)
        for name, value in security_headers().items():
            self.send_header(name, value)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def send_json(self, body: object, *, no_store: bool) -> None:
        self.send_response(200)
        for name, value in security_headers().items():
            self.send_header(name, value)
        if no_store:
            self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode("utf-8"))

    def log_message(self, _format: str, *_args: object) -> None:  # noqa: vulture
        return


class SmokeServer(ThreadingHTTPServer):
    fixture: SmokeFixture


class WebResponseSmokeTests(unittest.TestCase):
    def run_smoke(self, fixture: SmokeFixture) -> subprocess.CompletedProcess[str]:
        server = SmokeServer(("127.0.0.1", 0), SmokeHandler)
        server.fixture = fixture
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base_url = f"http://127.0.0.1:{server.server_port}"
            return subprocess.run(
                [
                    "node",
                    str(SMOKE_SCRIPT),
                    base_url,
                    "--expect-live",
                    "--expected-origin",
                    "https://receipts.groundlock.dev",
                    "--status-key-lookup",
                    "key:publisher.example:k1",
                    "--status-claim-lookup",
                    "claim:sha256:abc123",
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
                timeout=20,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_smoke_accepts_live_production_shape(self) -> None:
        result = self.run_smoke(SmokeFixture())

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PASS web response smoke", result.stdout)

    def test_smoke_rejects_stale_public_metadata(self) -> None:
        result = self.run_smoke(SmokeFixture(homepage_origin="http://localhost:3000"))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("canonical", result.stderr)
        self.assertIn("localhost", result.stderr)

    def test_smoke_rejects_live_health_without_status_records(self) -> None:
        result = self.run_smoke(SmokeFixture(status_records_configured=False))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("statusRecordsConfigured", result.stderr)


if __name__ == "__main__":
    unittest.main()
