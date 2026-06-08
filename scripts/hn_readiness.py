#!/usr/bin/env python3
"""Fail-closed launch readiness audit for the GroundLock Show HN post."""

from __future__ import annotations

import argparse
import base64
import hashlib
import html.parser
import json
import ipaddress
import re
import shutil
import subprocess
import sys
import unicodedata
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse, urlunparse


ROOT = Path(__file__).resolve().parents[1]
CLI_PATH = ROOT / "packages" / "cli" / "dist" / "cli.js"
DEFAULT_DRAFT_PATH = ROOT / "docs" / "show-hn-draft.md"
DEFAULT_REPO = "ucsandman/groundlock-receipts"
RESERVED_HOSTS = {
    "example.com",
    "example.net",
    "example.org",
    "localhost",
}
RESERVED_SUFFIXES = (
    ".example",
    ".example.com",
    ".example.net",
    ".example.org",
    ".invalid",
    ".localhost",
    ".test",
)
OG_IMAGE_PATH = "/groundlock-receipt-desk.png"
SITE_TITLE = "GroundLock Receipts"
DNS_LABEL_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
MAX_WEB_VERIFY_BYTES = 256 * 1024


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    detail: str


@dataclass(frozen=True)
class FixtureManifest:
    receipt_hash: str
    signer_domain: str
    kid: str
    chunk_count: int


class MetadataExtractor(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.canonical: str | None = None
        self.meta: dict[str, str] = {}
        self._in_title = False
        self._title_parts: list[str] = []

    def handle_starttag(  # noqa: vulture
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag.lower() == "title":
            self._in_title = True
            return
        values = {key.lower(): value for key, value in attrs if value is not None}
        if tag.lower() == "link" and "canonical" in values.get("rel", "").lower():
            self.canonical = values.get("href")
            return
        if tag.lower() != "meta":
            return
        content = values.get("content")
        key = values.get("property") or values.get("name")
        if key and content:
            self.meta[key.lower()] = content

    def handle_data(self, data: str) -> None:  # noqa: vulture
        if self._in_title:
            self._title_parts.append(data)

    def handle_endtag(self, tag: str) -> None:  # noqa: vulture
        if tag.lower() == "title":
            self._in_title = False

    @property
    def title(self) -> str:
        return " ".join(part.strip() for part in self._title_parts if part.strip())


def check_show_hn_draft(path: Path = DEFAULT_DRAFT_PATH) -> CheckResult:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return CheckResult("show-hn-draft", False, f"could not read {path}: {exc}")

    if "LOCAL_DEMO_ONLY" in text:
        return CheckResult(
            "show-hn-draft", False, "draft still contains LOCAL_DEMO_ONLY"
        )
    return CheckResult("show-hn-draft", True, "draft no longer marked LOCAL_DEMO_ONLY")


def validate_health_body(
    body: str, health_url: str | None = None, status_base_url: str | None = None
) -> CheckResult:
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        return CheckResult("health", False, f"invalid JSON: {exc}")

    if not isinstance(data, dict):
        return CheckResult("health", False, "health response is not a JSON object")
    if data.get("service") != "groundlock-web":
        return CheckResult(
            "health", False, "health response service is not groundlock-web"
        )
    if data.get("ok") is not True:
        return CheckResult("health", False, "health response ok is not true")
    if data.get("mode") != "live":
        return CheckResult(
            "health", False, "health response must be live mode for HN launch"
        )

    checks = data.get("checks")
    if not isinstance(checks, dict):
        return CheckResult("health", False, "health response checks is not an object")
    required = [
        "signerDomainConfigured",
        "siteUrlConfigured",
        "dohEndpointConfigured",
        "statusBaseUrlConfigured",
    ]
    missing = [name for name in required if checks.get(name) is not True]
    if missing:
        return CheckResult(
            "health", False, f"missing live health checks: {', '.join(missing)}"
        )
    if (
        uses_same_origin_status(health_url, status_base_url)
        and checks.get("statusRecordsConfigured") is not True
    ):
        return CheckResult(
            "health",
            False,
            "missing live health checks: statusRecordsConfigured",
        )

    return CheckResult("health", True, "deployed verifier reports live mode ready")


def health_endpoint(url: str) -> str:
    clean = url.strip().rstrip("/")
    if clean.endswith("/api/health"):
        return clean
    return f"{clean}/api/health"


def homepage_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.path.rstrip("/") == "/api/health":
        parsed = parsed._replace(path="/", params="", query="", fragment="")
        return urlunparse(parsed)
    clean = url.strip().rstrip("/")
    return f"{clean}/"


def verify_endpoint(url: str) -> str:
    return f"{homepage_url(url).rstrip('/')}/api/verify"


def uses_same_origin_status(
    health_url: str | None, status_base_url: str | None
) -> bool:
    if health_url is None or status_base_url is None:
        return False
    health_origin = url_origin(homepage_url(health_url))
    status_origin = url_origin(status_base_url)
    return health_origin is not None and health_origin == status_origin


def url_origin(value: str) -> str | None:
    parsed = urlparse(value.strip())
    if not parsed.scheme or not parsed.netloc:
        return None
    return urlunparse(parsed._replace(path="", params="", query="", fragment=""))


def check_launch_targets(args: argparse.Namespace) -> CheckResult:
    failures = []
    failures.extend(validate_public_health_url(args.health_url))
    failures.extend(validate_public_https_url("status-base-url", args.status_base_url))
    if args.doh_endpoint:
        failures.extend(validate_public_https_url("doh-endpoint", args.doh_endpoint))
    else:
        failures.append("doh-endpoint is required for HN launch")
    failures.extend(validate_public_domain("domain", args.domain, allow_ip=False))

    if failures:
        return CheckResult("launch-targets", False, "; ".join(failures))
    return CheckResult(
        "launch-targets", True, "launch URLs and signer domain are public HTTPS"
    )


def validate_public_health_url(value: str) -> list[str]:
    failures = validate_public_https_url("health-url", value)
    parsed = urlparse(value.strip())
    path = parsed.path.rstrip("/")
    if path not in ("", "/api/health"):
        failures.append("health-url path must be / or /api/health")
    return failures


def validate_public_https_url(label: str, value: str) -> list[str]:
    parsed = urlparse(value.strip())
    failures = []
    if parsed.scheme != "https":
        failures.append(f"{label} must use https")
    if parsed.username or parsed.password:
        failures.append(f"{label} must not include username or password")
    if parsed.query or parsed.fragment:
        failures.append(f"{label} must not include query or fragment")
    if not parsed.hostname:
        failures.append(f"{label} must include a hostname")
        return failures
    failures.extend(validate_public_domain(label, parsed.hostname))
    return failures


def validate_public_domain(
    label: str, value: str, *, allow_ip: bool = True
) -> list[str]:
    host = value.strip().rstrip(".").lower()
    if not host:
        return [f"{label} is empty"]
    if "://" in host:
        return [f"{label} must be a domain, not a URL"]
    if host in RESERVED_HOSTS or host.endswith(RESERVED_SUFFIXES):
        return [f"{label} uses a reserved placeholder host: {value}"]
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if "." not in host:
            return [f"{label} must be a public DNS name"]
        invalid_dns = len(host) > 253 or any(
            not DNS_LABEL_RE.match(part) for part in host.split(".")
        )
        if invalid_dns:
            return [f"{label} must be a valid public DNS name"]
        return []
    if not allow_ip:
        return [f"{label} must be a DNS name, not an IP address: {value}"]
    if not ip.is_global:
        return [f"{label} must not use a private or local IP address: {value}"]
    return []


def check_health_url(
    url: str, status_base_url: str | None = None, timeout: float = 10.0
) -> CheckResult:
    endpoint = health_endpoint(url)
    request = urllib.request.Request(
        endpoint, headers={"User-Agent": "groundlock-hn-readiness/1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(256_000).decode("utf-8", errors="replace")
            if response.status != 200:
                return CheckResult(
                    "health", False, f"{endpoint} returned HTTP {response.status}"
                )
    except Exception as exc:
        return CheckResult("health", False, f"{endpoint} failed: {exc}")

    return validate_health_body(body, health_url=url, status_base_url=status_base_url)


def extract_metadata(html: str) -> MetadataExtractor:
    extractor = MetadataExtractor()
    extractor.feed(html)
    return extractor


def normalize_root_url(value: str | None) -> str | None:
    if value is None:
        return None
    parsed = urlparse(value.strip())
    if parsed.path in ("", "/") and not parsed.params and not parsed.query:
        return urlunparse(parsed._replace(path="/", params="", query="", fragment=""))
    return value.strip()


def validate_homepage_metadata(html: str, expected_home_url: str) -> CheckResult:
    expected_home = homepage_url(expected_home_url)
    expected_origin = urlparse(expected_home)._replace(
        path="", params="", query="", fragment=""
    )
    origin = urlunparse(expected_origin)
    metadata = extract_metadata(html)
    failures = []

    if normalize_root_url(metadata.canonical) != expected_home:
        failures.append(
            f"canonical href is {metadata.canonical!r}, expected {expected_home}"
        )
    if normalize_root_url(metadata.meta.get("og:url")) != expected_home:
        failures.append(
            f"og:url is {metadata.meta.get('og:url')!r}, expected {expected_home}"
        )
    expected_image = f"{origin}{OG_IMAGE_PATH}"
    if metadata.meta.get("og:image") != expected_image:
        failures.append(
            f"og:image is {metadata.meta.get('og:image')!r}, expected {expected_image}"
        )
    if metadata.meta.get("twitter:image") != expected_image:
        failures.append(
            "twitter:image is "
            f"{metadata.meta.get('twitter:image')!r}, expected {expected_image}"
        )
    if SITE_TITLE not in metadata.title:
        failures.append(
            f"title is {metadata.title!r}, expected it to contain {SITE_TITLE!r}"
        )

    if failures:
        return CheckResult("metadata", False, "; ".join(failures))
    return CheckResult("metadata", True, "homepage metadata matches launch URL")


def check_homepage_metadata(url: str, timeout: float = 10.0) -> CheckResult:
    endpoint = homepage_url(url)
    request = urllib.request.Request(
        endpoint, headers={"User-Agent": "groundlock-hn-readiness/1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(512_000).decode("utf-8", errors="replace")
            if response.status != 200:
                return CheckResult(
                    "metadata", False, f"{endpoint} returned HTTP {response.status}"
                )
    except Exception as exc:
        return CheckResult("metadata", False, f"{endpoint} failed: {exc}")

    return validate_homepage_metadata(body, endpoint)


def build_web_verify_body(file_or_hash: str) -> dict[str, str]:
    if file_or_hash.startswith("sha256:"):
        return {"hash": file_or_hash}
    path = Path(file_or_hash)
    data = path.read_bytes()
    if len(data) > MAX_WEB_VERIFY_BYTES:
        raise ValueError("web_verify_input_too_large")
    return {"fileText": data.decode("utf-8")}


def validate_web_verify_body(body: str) -> CheckResult:
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        return CheckResult("web-verify", False, f"invalid JSON: {exc}")

    if not isinstance(data, dict):
        return CheckResult("web-verify", False, "verify response is not a JSON object")
    state = data.get("state")
    code = data.get("code")
    if state != "PASS" or code != "verified":
        return CheckResult(
            "web-verify",
            False,
            f"deployed /api/verify returned state={state} code={code}",
        )
    return CheckResult("web-verify", True, "deployed /api/verify returned PASS")


def check_web_verify(url: str, file_or_hash: str, timeout: float = 10.0) -> CheckResult:
    endpoint = verify_endpoint(url)
    try:
        payload = json.dumps(build_web_verify_body(file_or_hash)).encode("utf-8")
    except Exception as exc:
        return CheckResult("web-verify", False, f"could not build request body: {exc}")

    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "groundlock-hn-readiness/1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(256_000).decode("utf-8", errors="replace")
            if response.status != 200:
                return CheckResult(
                    "web-verify", False, f"{endpoint} returned HTTP {response.status}"
                )
    except Exception as exc:
        return CheckResult("web-verify", False, f"{endpoint} failed: {exc}")

    return validate_web_verify_body(body)


def check_dns_fixture(path: str, domain: str, file_or_hash: str) -> CheckResult:
    try:
        content_hash = content_hash_for_input(file_or_hash)
    except Exception as exc:
        return CheckResult("dns-fixture", False, f"could not compute demo hash: {exc}")

    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except OSError as exc:
        return CheckResult("dns-fixture", False, f"could not read {path}: {exc}")
    except json.JSONDecodeError as exc:
        return CheckResult("dns-fixture", False, f"invalid JSON: {exc}")

    if not isinstance(data, dict):
        return CheckResult("dns-fixture", False, "fixture is not a JSON object")

    expected_domain = normalize_domain(domain)
    failures = []
    fixture_domain = data.get("domain")
    if not isinstance(fixture_domain, str):
        failures.append("fixture domain is missing")
    elif normalize_domain(fixture_domain) != expected_domain:
        failures.append(
            f"fixture domain {fixture_domain!r} does not match launch domain {domain!r}"
        )

    txt = data.get("txt")
    if not isinstance(txt, dict) or not txt:
        failures.append("fixture txt records are missing")
        manifest = None
    else:
        txt_failures, manifest = validate_fixture_txt_records(
            txt, expected_domain, content_hash
        )
        failures.extend(txt_failures)

    status = data.get("status")
    if not isinstance(status, dict):
        failures.append("fixture status records are missing")
    else:
        key = status.get("key")
        claim = status.get("claim")
        if not isinstance(key, dict) or key.get("kind") != "key":
            failures.append("fixture key status record is missing")
        elif manifest is not None:
            failures.extend(validate_key_status_record(key, manifest))
        if not isinstance(claim, dict) or claim.get("kind") != "claim":
            failures.append("fixture claim status record is missing")
        elif manifest is not None:
            failures.extend(validate_claim_status_record(claim, manifest))

    if failures:
        return CheckResult("dns-fixture", False, "; ".join(failures))
    return CheckResult(
        "dns-fixture", True, "fixture domain, TXT records, and statuses match launch"
    )


def validate_fixture_txt_records(
    txt: dict[object, object], expected_domain: str, content_hash: str
) -> tuple[list[str], FixtureManifest | None]:
    failures = []
    normalized: dict[str, list[str]] = {}
    for name, values in txt.items():
        if (
            not isinstance(name, str)
            or not isinstance(values, list)
            or not all(isinstance(value, str) for value in values)
        ):
            failures.append("fixture TXT answers must map names to string arrays")
            break
        normalized[normalize_domain(name)] = values

    identity_name = f"_truename.{expected_domain}"
    identity_values = normalized.get(identity_name)
    identity_kid = None
    if identity_values is None:
        failures.append(f"fixture identity TXT record is missing: {identity_name}")
    else:
        identity_kid = parse_fixture_identity_kid(identity_values)
        if identity_kid is None:
            failures.append(
                f"fixture identity TXT record is malformed or ambiguous: {identity_name}"
            )

    manifest_suffix = f"._groundlock.{expected_domain}"
    expected_manifest_name = f"gl-{cache_label(content_hash)}{manifest_suffix}"
    manifest = parse_fixture_manifest(normalized.get(expected_manifest_name, []))
    if manifest is None:
        failures.append(
            f"fixture cache manifest TXT record for demo hash is missing: {expected_manifest_name}"
        )

    if manifest is not None:
        if manifest.signer_domain != expected_domain:
            failures.append(
                "fixture cache manifest signer domain does not match launch domain"
            )
        if identity_kid is not None and identity_kid != manifest.kid:
            failures.append(
                "fixture identity TXT record does not match cache manifest key"
            )
        failures.extend(
            validate_manifest_chunks(
                normalized, expected_manifest_name, manifest.chunk_count
            )
        )

    return failures, manifest


def parse_fixture_manifest(values: list[str]) -> FixtureManifest | None:
    for value in values:
        if not value.startswith("gdm1 "):
            continue
        parts = parse_kv_record(value, "gdm1")
        receipt_hash = parts.get("rh")
        chunk_count_raw = parts.get("n")
        key = parts.get("key")
        if not receipt_hash or not chunk_count_raw or not key or "#" not in key:
            return None
        try:
            chunk_count = int(chunk_count_raw)
        except ValueError:
            return None
        if chunk_count <= 0:
            return None
        signer_domain, kid = key.split("#", 1)
        if not signer_domain or not kid:
            return None
        return FixtureManifest(
            receipt_hash=ensure_sha256(receipt_hash),
            signer_domain=normalize_domain(signer_domain),
            kid=kid,
            chunk_count=chunk_count,
        )
    return None


def parse_fixture_identity_kid(values: list[str]) -> str | None:
    identities = set()
    for value in values:
        if not value.startswith("glt1 "):
            continue
        parts = parse_kv_record(value, "glt1")
        kid = parts.get("kid")
        alg = parts.get("alg")
        jwk = parts.get("jwk")
        if not kid or alg != "EdDSA" or not jwk:
            continue
        public_key = parse_base64url_json_object(jwk)
        if public_key is None:
            continue
        identities.add((kid, canonical_json(public_key)))
    if len(identities) != 1:
        return None
    return next(iter(identities))[0]


def parse_base64url_json_object(value: str) -> dict[str, object] | None:
    try:
        padding = "=" * (-len(value) % 4)
        raw = base64.b64decode(f"{value}{padding}", altchars=b"-_", validate=True)
        parsed = json.loads(raw.decode("utf-8"))
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


def canonical_json(value: object) -> str:
    return json.dumps(value, separators=(",", ":"), sort_keys=True)


def validate_manifest_chunks(
    txt: dict[str, list[str]], manifest_name: str, chunk_count: int
) -> list[str]:
    failures = []
    for index in range(chunk_count):
        chunk_name = f"c{index}.{manifest_name}"
        values = txt.get(chunk_name)
        if not values:
            failures.append(f"fixture cache chunk TXT record is missing: {chunk_name}")
            continue
        expected_prefix = f"gdc1 i={index} "
        if not any(value.startswith(expected_prefix) for value in values):
            failures.append(
                f"fixture cache chunk TXT record has wrong index: {chunk_name}"
            )
    return failures


def parse_kv_record(value: str, prefix: str) -> dict[str, str]:
    tokens = value.split()
    if not tokens or tokens[0] != prefix:
        return {}
    pairs = {}
    for token in tokens[1:]:
        if "=" not in token:
            continue
        key, item = token.split("=", 1)
        pairs[key] = item
    return pairs


def validate_key_status_record(
    record: dict[object, object], manifest: FixtureManifest
) -> list[str]:
    failures = []
    subject = record.get("subject")
    if not isinstance(subject, dict):
        return ["fixture key status subject is missing"]
    signer_domain = subject.get("signerDomain")
    kid = subject.get("kid")
    if (
        not isinstance(signer_domain, str)
        or normalize_domain(signer_domain) != manifest.signer_domain
        or kid != manifest.kid
    ):
        failures.append("fixture key status does not match cache manifest key")
    if record.get("status") != "active":
        failures.append("fixture key status is not active")
    return failures


def validate_claim_status_record(
    record: dict[object, object], manifest: FixtureManifest
) -> list[str]:
    failures = []
    subject = record.get("subject")
    if not isinstance(subject, dict):
        return ["fixture claim status subject is missing"]
    receipt_hash = subject.get("receiptHash")
    if (
        not isinstance(receipt_hash, str)
        or ensure_sha256(receipt_hash) != manifest.receipt_hash
    ):
        failures.append("fixture claim status does not match cache manifest receipt")
    if record.get("status") != "active":
        failures.append("fixture claim status is not active")
    return failures


def normalize_domain(value: str) -> str:
    return value.strip().rstrip(".").lower()


def ensure_sha256(value: str) -> str:
    return value if value.startswith("sha256:") else f"sha256:{value}"


def content_hash_for_input(file_or_hash: str) -> str:
    if file_or_hash.startswith("sha256:"):
        if len(file_or_hash) <= len("sha256:"):
            raise ValueError("empty_sha256_hash")
        return file_or_hash
    data = Path(file_or_hash).read_bytes()
    if len(data) > MAX_WEB_VERIFY_BYTES:
        raise ValueError("web_verify_input_too_large")
    return digest_text(data.decode("utf-8"))


def digest_text(value: str) -> str:
    canonical = canonicalize_text(value)
    digest = hashlib.sha256(canonical.encode("utf-8")).digest()
    encoded = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return f"sha256:{encoded}"


def canonicalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    replacements = {
        "\u2012": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\u2015": "-",
        "\u2010": "-",
        "\u2011": "-",
        "\u2212": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201a": "'",
        "\u201b": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u201e": '"',
        "\u201f": '"',
        "\u2026": "...",
        "\u00a0": " ",
    }
    for source, target in replacements.items():
        normalized = normalized.replace(source, target)
    return normalized


def cache_label(value: str) -> str:
    hash_value = value[len("sha256:") :] if value.startswith("sha256:") else value
    return re.sub(r"[^a-z0-9-]", "-", hash_value.lower().replace("_", "-"))


def build_check_live_argv(
    file_or_hash: str,
    domain: str,
    status_base_url: str,
    doh_endpoint: str | None = None,
) -> list[str]:
    argv = [
        "node",
        str(CLI_PATH),
        "check-live",
        file_or_hash,
        "--domain",
        domain,
        "--status-base-url",
        status_base_url,
    ]
    if doh_endpoint:
        argv.extend(["--doh-endpoint", doh_endpoint])
    return argv


def build_warm_cache_argv(
    dns_fixture: str, doh_endpoint: str | None = None
) -> list[str]:
    argv = ["node", str(CLI_PATH), "warm-cache", dns_fixture]
    if doh_endpoint:
        argv.extend(["--doh-endpoint", doh_endpoint])
    return argv


def check_warm_cache(dns_fixture: str, doh_endpoint: str | None = None) -> CheckResult:
    if not CLI_PATH.is_file():
        return CheckResult(
            "warm-cache", False, f"missing built CLI at {CLI_PATH}; run npm run build"
        )

    argv = build_warm_cache_argv(dns_fixture, doh_endpoint)
    proc = subprocess.run(argv, cwd=str(ROOT), capture_output=True, text=True)
    output = "\n".join(
        part for part in [proc.stdout.strip(), proc.stderr.strip()] if part
    )
    if proc.returncode != 0:
        return CheckResult(
            "warm-cache", False, output or f"warm-cache exited {proc.returncode}"
        )
    if not proc.stdout.lstrip().startswith("PASS "):
        return CheckResult(
            "warm-cache", False, output or "warm-cache did not report PASS"
        )
    return CheckResult("warm-cache", True, proc.stdout.strip())


def check_live_receipt(
    file_or_hash: str,
    domain: str,
    status_base_url: str,
    doh_endpoint: str | None = None,
) -> CheckResult:
    if not CLI_PATH.is_file():
        return CheckResult(
            "check-live", False, f"missing built CLI at {CLI_PATH}; run npm run build"
        )

    argv = build_check_live_argv(file_or_hash, domain, status_base_url, doh_endpoint)
    proc = subprocess.run(argv, cwd=str(ROOT), capture_output=True, text=True)
    output = "\n".join(
        part for part in [proc.stdout.strip(), proc.stderr.strip()] if part
    )
    if proc.returncode != 0:
        return CheckResult(
            "check-live", False, output or f"check-live exited {proc.returncode}"
        )
    if not proc.stdout.lstrip().startswith("PASS "):
        return CheckResult(
            "check-live", False, output or "check-live did not report PASS"
        )
    return CheckResult("check-live", True, proc.stdout.strip())


def check_git_clean() -> CheckResult:
    proc = subprocess.run(
        ["git", "status", "--short"], cwd=str(ROOT), capture_output=True, text=True
    )
    if proc.returncode != 0:
        return CheckResult("git", False, proc.stderr.strip() or "git status failed")
    if proc.stdout.strip():
        return CheckResult("git", False, "worktree is not clean")
    return CheckResult("git", True, "worktree clean")


def current_git_head() -> str | None:
    proc = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=str(ROOT), capture_output=True, text=True
    )
    if proc.returncode != 0:
        return None
    return proc.stdout.strip() or None


def validate_ci_runs(runs: object, expected_head_sha: str | None) -> CheckResult:
    if not isinstance(runs, list) or not runs:
        return CheckResult("ci", False, "no CI runs found")

    run = runs[0]
    if not isinstance(run, dict):
        return CheckResult("ci", False, "CI run data is malformed")
    status = run.get("status")
    conclusion = run.get("conclusion")
    head_sha = run.get("headSha")
    if expected_head_sha and head_sha != expected_head_sha:
        return CheckResult(
            "ci",
            False,
            f"latest CI headSha={head_sha} does not match current HEAD={expected_head_sha}",
        )
    if status != "completed" or conclusion != "success":
        return CheckResult(
            "ci", False, f"latest CI is status={status} conclusion={conclusion}"
        )
    return CheckResult("ci", True, f"latest CI run {run.get('databaseId')} succeeded")


def check_ci(repo: str, branch: str) -> CheckResult:
    if shutil.which("gh") is None:
        return CheckResult("ci", False, "GitHub CLI gh is required to verify CI status")

    expected_head_sha = current_git_head()
    if expected_head_sha is None:
        return CheckResult("ci", False, "could not read current git HEAD")

    proc = subprocess.run(
        [
            "gh",
            "run",
            "list",
            "--repo",
            repo,
            "--workflow",
            "CI",
            "--branch",
            branch,
            "--limit",
            "1",
            "--json",
            "status,conclusion,headSha,databaseId",
        ],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return CheckResult("ci", False, proc.stderr.strip() or "gh run list failed")

    try:
        runs = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        return CheckResult("ci", False, f"could not parse gh output: {exc}")
    return validate_ci_runs(runs, expected_head_sha)


def run_checks(args: argparse.Namespace) -> list[CheckResult]:
    preflight = [
        check_git_clean(),
        check_show_hn_draft(Path(args.show_hn_draft)),
        check_launch_targets(args),
        check_dns_fixture(args.dns_fixture, args.domain, args.file_or_hash),
    ]
    if any(not result.ok for result in preflight):
        return preflight

    return [
        *preflight,
        check_ci(args.repo, args.branch),
        check_health_url(args.health_url, args.status_base_url),
        check_homepage_metadata(args.health_url),
        check_warm_cache(args.dns_fixture, args.doh_endpoint),
        check_live_receipt(
            args.file_or_hash, args.domain, args.status_base_url, args.doh_endpoint
        ),
        check_web_verify(args.health_url, args.file_or_hash),
    ]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit external Show HN launch readiness evidence."
    )
    parser.add_argument(
        "--health-url",
        required=True,
        help="deployed verifier root URL or exact /api/health URL",
    )
    parser.add_argument(
        "--file-or-hash",
        required=True,
        help="public demo file path or sha256: hash for check-live",
    )
    parser.add_argument(
        "--dns-fixture",
        required=True,
        help="dns-fixture.json for warm-cache",
    )
    parser.add_argument("--domain", required=True, help="publisher signer domain")
    parser.add_argument(
        "--status-base-url", required=True, help="public status endpoint base URL"
    )
    parser.add_argument(
        "--doh-endpoint", required=True, help="DNS-over-HTTPS endpoint for launch"
    )
    parser.add_argument(
        "--repo", default=DEFAULT_REPO, help="GitHub repository for CI verification"
    )
    parser.add_argument(
        "--branch", default="main", help="GitHub branch for CI verification"
    )
    parser.add_argument(
        "--show-hn-draft", default=str(DEFAULT_DRAFT_PATH), help="Show HN draft path"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    results = run_checks(args)
    for result in results:
        state = "PASS" if result.ok else "FAIL"
        print(f"{state} {result.name}: {result.detail}")
    return 0 if all(result.ok for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
