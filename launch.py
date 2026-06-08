#!/usr/bin/env python3
"""
Launch GroundLock locally for hands-on testing.

The launcher checks the local toolchain, installs dependencies when needed,
builds the workspaces, runs the test suite, starts the Next.js verifier app,
and opens the browser to the local verifier.

Usage:
  python launch.py
  python launch.py --port 3005
  python launch.py --skip-tests
  python launch.py --skip-build --no-browser
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import webbrowser
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent
IS_WIN = os.name == "nt"


@dataclass(frozen=True)
class LaunchOptions:
    host: str
    port: int
    skip_install: bool
    skip_build: bool
    skip_tests: bool
    no_browser: bool


def have(cmd: str) -> bool:
    return shutil.which(cmd) is not None or (
        IS_WIN and shutil.which(f"{cmd}.cmd") is not None
    )


def npm_argv(args: list[str]) -> list[str]:
    return ["cmd", "/c", "npm", *args] if IS_WIN else ["npm", *args]


def dev_server_argv(host: str, port: int) -> list[str]:
    return npm_argv(
        [
            "run",
            "dev",
            "--workspace",
            "@groundlock/web",
            "--",
            "--hostname",
            host,
            "--port",
            str(port),
        ]
    )


def browser_url(host: str, port: int) -> str:
    browser_host = "127.0.0.1" if host in {"0.0.0.0", "::", ""} else host
    if ":" in browser_host and not browser_host.startswith("["):
        browser_host = f"[{browser_host}]"
    return f"http://{browser_host}:{port}"


def dependencies_installed() -> bool:
    return (ROOT / "node_modules").is_dir()


def preflight_steps(
    options: LaunchOptions, dependencies_installed: bool
) -> list[tuple[str, list[str]]]:
    steps: list[tuple[str, list[str]]] = []
    if not options.skip_install and not dependencies_installed:
        steps.append(("install dependencies", ["install"]))
    if not options.skip_build:
        steps.append(("build packages", ["run", "build"]))
    if not options.skip_tests:
        steps.append(("run tests", ["test"]))
    return steps


def run_npm(label: str, args: list[str]) -> int:
    argv = npm_argv(args)
    print(f"\n[{label}]\n> {' '.join(argv)}\n", flush=True)
    return subprocess.run(argv, cwd=str(ROOT)).returncode


def run_preflight(options: LaunchOptions) -> int:
    for label, args in preflight_steps(options, dependencies_installed()):
        exit_code = run_npm(label, args)
        if exit_code != 0:
            print(f"\nERROR: {label} failed with exit code {exit_code}.")
            return exit_code
    if options.skip_install:
        print("Skipping dependency install (--skip-install).")
    elif dependencies_installed():
        print("Dependencies are already installed.")
    if options.skip_build:
        print("Skipping build (--skip-build).")
    if options.skip_tests:
        print("Skipping tests (--skip-tests).")
    return 0


def start_dev_server(options: LaunchOptions) -> subprocess.Popen:
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if IS_WIN else 0
    return subprocess.Popen(
        dev_server_argv(options.host, options.port),
        cwd=str(ROOT),
        creationflags=creationflags,
    )


def stop_dev_server(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if IS_WIN:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            capture_output=True,
            text=True,
        )
    else:
        proc.terminate()


def wait_for_server(url: str, timeout: float = 120.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return True
        except Exception:
            time.sleep(0.7)
    return False


def parse_args(argv: list[str] | None = None) -> LaunchOptions:
    parser = argparse.ArgumentParser(
        description="Install, verify, start, and open the GroundLock local verifier."
    )
    parser.add_argument("--host", default="127.0.0.1", help="dev server host")
    parser.add_argument("--port", type=int, default=3000, help="dev server port")
    parser.add_argument(
        "--skip-install",
        action="store_true",
        help="do not run npm install when node_modules is missing",
    )
    parser.add_argument("--skip-build", action="store_true", help="skip npm run build")
    parser.add_argument("--skip-tests", action="store_true", help="skip npm test")
    parser.add_argument(
        "--no-browser",
        "--no-open",
        action="store_true",
        dest="no_browser",
        help="start the app without opening a browser tab",
    )
    parsed = parser.parse_args(argv)
    return LaunchOptions(
        host=parsed.host,
        port=parsed.port,
        skip_install=parsed.skip_install,
        skip_build=parsed.skip_build,
        skip_tests=parsed.skip_tests,
        no_browser=parsed.no_browser,
    )


def main(argv: list[str] | None = None) -> int:
    options = parse_args(argv)

    print("GroundLock local launcher")
    print(f"Repository: {ROOT}")

    if not have("node") or not have("npm"):
        print("ERROR: Node.js and npm are required on PATH.")
        print("Install Node.js 20+ and rerun: python launch.py")
        return 1

    preflight_exit = run_preflight(options)
    if preflight_exit != 0:
        return preflight_exit

    url = browser_url(options.host, options.port)
    print(
        f"\n[start web verifier]\n> {' '.join(dev_server_argv(options.host, options.port))}"
    )
    print(f"\nWaiting for {url}. Press Ctrl+C to stop the server.\n")

    proc = start_dev_server(options)
    try:
        if not wait_for_server(url):
            print(f"ERROR: dev server did not respond at {url} within 120 seconds.")
            stop_dev_server(proc)
            return 1

        print(f"GroundLock verifier is running at {url}")
        if not options.no_browser:
            webbrowser.open(url)
            print("Opened the verifier in your browser.")
        else:
            print("Browser opening skipped (--no-browser).")
        return proc.wait()
    except KeyboardInterrupt:
        print("\nStopping GroundLock verifier...")
        return 0
    finally:
        stop_dev_server(proc)


if __name__ == "__main__":
    sys.exit(main())
