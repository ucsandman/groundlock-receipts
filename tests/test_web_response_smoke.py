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
PNG_BYTES = b"\x89PNG\r\n\x1a\nsmoke-test-png"


def security_headers() -> dict[str, str]:
    return {
        name: "; ".join(values)
        for name, values in CONTRACT["requiredHeaderValues"].items()
    }


def homepage_html(origin: str, *, share_image_url: str | None = None) -> str:
    image_url = share_image_url or f"{origin}/groundlock-receipt-desk.png"
    return f"""
    <html>
      <head>
        <link rel="canonical" href="{origin}/">
        <meta property="og:url" content="{origin}/">
        <meta property="og:image" content="{image_url}">
        <meta name="twitter:image" content="{image_url}">
      </head>
      <body>GroundLock Receipts</body>
    </html>
    """


def robots_text(origin: str) -> str:
    return "\n".join(
        [
            "User-Agent: *",
            "Allow: /",
            "Disallow: /api/",
            "Disallow: /groundlock/status/",
            f"Sitemap: {origin}/sitemap.xml",
            "",
        ]
    )


def sitemap_xml(origin: str, *, expose_api: bool = False) -> str:
    urls = [f"{origin}/", f"{origin}/threat-model"]
    if expose_api:
        urls.append(f"{origin}/api/health")
    items = "".join(f"<url><loc>{url}</loc></url>" for url in urls)
    return (
        f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{items}</urlset>'
    )


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


def status_record(kind: str, *, mismatch_subject: bool = False) -> dict[str, object]:
    if kind == "key":
        return {
            "version": "groundlock-status/v1",
            "kind": "key",
            "subject": {
                "signerDomain": (
                    "other.groundlock.dev" if mismatch_subject else "publisher.example"
                ),
                "kid": "k1",
            },
            "status": "active",
            "issuedAt": "2026-06-08T00:00:00.000Z",
        }
    return {
        "version": "groundlock-status/v1",
        "kind": "claim",
        "subject": {
            "receiptHash": "sha256:other" if mismatch_subject else "sha256:abc123"
        },
        "status": "active",
        "issuedAt": "2026-06-08T00:00:00.000Z",
    }


class SmokeFixture:
    def __init__(
        self,
        *,
        homepage_origin: str = "https://receipts.groundlock.dev",
        discovery_origin: str | None = None,
        discovery_exposes_api: bool = False,
        status_subject_mismatch: bool = False,
        status_records_configured: bool = True,
        verify_state: str = "PASS",
        verify_no_store: bool = True,
        share_image_metadata_url: str | None = None,
        share_image_content_type: str = "image/png",
        share_image_body: bytes = PNG_BYTES,
        share_image_security_headers: bool = True,
    ) -> None:
        self.homepage_origin = homepage_origin
        self.discovery_origin = discovery_origin or homepage_origin
        self.discovery_exposes_api = discovery_exposes_api
        self.status_subject_mismatch = status_subject_mismatch
        self.status_records_configured = status_records_configured
        self.verify_state = verify_state
        self.verify_no_store = verify_no_store
        self.share_image_metadata_url = share_image_metadata_url
        self.share_image_content_type = share_image_content_type
        self.share_image_body = share_image_body
        self.share_image_security_headers = share_image_security_headers
        self.verify_requests: list[object] = []


class SmokeHandler(BaseHTTPRequestHandler):
    server: "SmokeServer"

    def do_GET(self) -> None:  # noqa: vulture
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_text(
                homepage_html(
                    self.server.fixture.homepage_origin,
                    share_image_url=self.server.fixture.share_image_metadata_url,
                )
            )
            return
        if parsed.path == "/groundlock-receipt-desk.png":
            self.send_binary(
                self.server.fixture.share_image_body,
                content_type=self.server.fixture.share_image_content_type,
                include_security_headers=self.server.fixture.share_image_security_headers,
            )
            return
        if parsed.path == "/robots.txt":
            self.send_text(robots_text(self.server.fixture.discovery_origin))
            return
        if parsed.path == "/sitemap.xml":
            self.send_text(
                sitemap_xml(
                    self.server.fixture.discovery_origin,
                    expose_api=self.server.fixture.discovery_exposes_api,
                )
            )
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

    def do_POST(self) -> None:  # noqa: vulture
        parsed = urlparse(self.path)
        if parsed.path != "/api/verify":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        try:
            self.server.fixture.verify_requests.append(json.loads(raw))
        except json.JSONDecodeError:
            self.server.fixture.verify_requests.append(raw)

        state = self.server.fixture.verify_state
        self.send_json(
            {
                "state": state,
                "code": "verified" if state == "PASS" else "dns_txt_missing",
                "explanation": "test verifier response",
                "whatItProves": "test proof boundary",
                "whatItDoesNotProve": "test non-proof boundary",
                "receiptSummary": (
                    {
                        "signerDomain": "publisher.example",
                        "signerKeyId": "k1",
                        "contentClass": "demo-message",
                        "issuedAt": "2026-06-08T00:00:00.000Z",
                        "verdict": "pass",
                        "contentHash": "sha256:testhash",
                        "receiptHash": "sha256:testreceipt",
                    }
                    if state == "PASS"
                    else None
                ),
                "timingMs": 1,
            },
            no_store=self.server.fixture.verify_no_store,
        )

    def send_status_record(self, query: str, kind: str, expected_lookup: str) -> None:
        lookup = parse_qs(query).get("lookup", [""])[0]
        if lookup != expected_lookup:
            self.send_response(404)
            self.end_headers()
            return
        self.send_json(
            status_record(
                kind, mismatch_subject=self.server.fixture.status_subject_mismatch
            ),
            no_store=True,
        )

    def send_text(self, body: str) -> None:
        self.send_response(200)
        for name, value in security_headers().items():
            self.send_header(name, value)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body.encode("utf-8"))

    def send_binary(
        self, body: bytes, *, content_type: str, include_security_headers: bool
    ) -> None:
        self.send_response(200)
        if include_security_headers:
            for name, value in security_headers().items():
                self.send_header(name, value)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(body)

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
    def run_smoke(
        self,
        fixture: SmokeFixture,
        extra_args: list[str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        server = SmokeServer(("127.0.0.1", 0), SmokeHandler)
        server.fixture = fixture
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base_url = f"http://127.0.0.1:{server.server_port}"
            args = [
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
            ]
            if extra_args:
                args.extend(extra_args)
            return subprocess.run(
                args,
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

    def test_smoke_rejects_wrong_share_image_metadata_path(self) -> None:
        result = self.run_smoke(
            SmokeFixture(
                share_image_metadata_url="https://receipts.groundlock.dev/other.png"
            )
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("og:image", result.stderr)
        self.assertIn("groundlock-receipt-desk.png", result.stderr)

    def test_smoke_rejects_share_image_without_security_headers(self) -> None:
        result = self.run_smoke(SmokeFixture(share_image_security_headers=False))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/groundlock-receipt-desk.png missing", result.stderr)

    def test_smoke_rejects_share_image_with_wrong_content_type(self) -> None:
        result = self.run_smoke(SmokeFixture(share_image_content_type="text/plain"))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Content-Type is text/plain", result.stderr)

    def test_smoke_rejects_share_image_without_png_bytes(self) -> None:
        result = self.run_smoke(SmokeFixture(share_image_body=b"not a png"))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("did not return PNG bytes", result.stderr)

    def test_smoke_rejects_stale_public_discovery_files(self) -> None:
        result = self.run_smoke(
            SmokeFixture(
                discovery_origin="http://localhost:3000",
                discovery_exposes_api=True,
            )
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/robots.txt missing sitemap", result.stderr)

    def test_smoke_rejects_live_health_without_status_records(self) -> None:
        result = self.run_smoke(SmokeFixture(status_records_configured=False))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("statusRecordsConfigured", result.stderr)

    def test_smoke_rejects_status_record_subject_mismatch(self) -> None:
        result = self.run_smoke(SmokeFixture(status_subject_mismatch=True))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("subject does not match key:publisher.example:k1", result.stderr)

    def test_smoke_accepts_verify_pass_response(self) -> None:
        fixture = SmokeFixture()
        result = self.run_smoke(
            fixture,
            [
                "--verify-file-text",
                "Dear Jane Roe, your account AC-40192 shows a balance of $1,500.00.",
            ],
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PASS web response smoke", result.stdout)
        self.assertEqual(
            fixture.verify_requests,
            [
                {
                    "fileText": "Dear Jane Roe, your account AC-40192 shows a balance of $1,500.00."
                }
            ],
        )

    def test_smoke_rejects_verify_state_mismatch(self) -> None:
        result = self.run_smoke(
            SmokeFixture(verify_state="UNVERIFIABLE"),
            ["--verify-hash", "sha256:testhashvalue"],
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "/api/verify returned state UNVERIFIABLE, expected PASS", result.stderr
        )

    def test_smoke_rejects_verify_without_no_store(self) -> None:
        result = self.run_smoke(
            SmokeFixture(verify_no_store=False),
            ["--verify-hash", "sha256:testhashvalue"],
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("/api/verify missing Cache-Control: no-store", result.stderr)


if __name__ == "__main__":
    unittest.main()
