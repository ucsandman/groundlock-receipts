#!/usr/bin/env python3
"""Fail-closed launch readiness audit for the GroundLock Show HN post."""

from __future__ import annotations

import argparse
import html.parser
import json
import ipaddress
import shutil
import subprocess
import sys
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


@dataclass(frozen=True)
class CheckResult:
    name: str
    ok: bool
    detail: str


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


def validate_health_body(body: str) -> CheckResult:
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


def check_launch_targets(args: argparse.Namespace) -> CheckResult:
    failures = []
    for label, url in [
        ("health-url", args.health_url),
        ("status-base-url", args.status_base_url),
    ]:
        failures.extend(validate_public_https_url(label, url))
    if args.doh_endpoint:
        failures.extend(validate_public_https_url("doh-endpoint", args.doh_endpoint))
    else:
        failures.append("doh-endpoint is required for HN launch")
    failures.extend(validate_public_domain("domain", args.domain))

    if failures:
        return CheckResult("launch-targets", False, "; ".join(failures))
    return CheckResult(
        "launch-targets", True, "launch URLs and signer domain are public HTTPS"
    )


def validate_public_https_url(label: str, value: str) -> list[str]:
    parsed = urlparse(value.strip())
    failures = []
    if parsed.scheme != "https":
        failures.append(f"{label} must use https")
    if not parsed.hostname:
        failures.append(f"{label} must include a hostname")
        return failures
    failures.extend(validate_public_domain(label, parsed.hostname))
    return failures


def validate_public_domain(label: str, value: str) -> list[str]:
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
        return []
    if not ip.is_global:
        return [f"{label} must not use a private or local IP address: {value}"]
    return []


def check_health_url(url: str, timeout: float = 10.0) -> CheckResult:
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

    return validate_health_body(body)


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
    ]
    if any(not result.ok for result in preflight):
        return preflight

    return [
        *preflight,
        check_ci(args.repo, args.branch),
        check_health_url(args.health_url),
        check_homepage_metadata(args.health_url),
        check_warm_cache(args.dns_fixture, args.doh_endpoint),
        check_live_receipt(
            args.file_or_hash, args.domain, args.status_base_url, args.doh_endpoint
        ),
    ]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit external Show HN launch readiness evidence."
    )
    parser.add_argument(
        "--health-url",
        required=True,
        help="deployed verifier base URL or /api/health URL",
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
