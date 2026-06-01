#!/usr/bin/env python3
"""
launch.py - one command to start GroundLock locally so you can try it.

WHAT GROUNDLOCK IS (the short version):
  You give it two things:
    1. an AI-drafted message (e.g. a billing notice an AI wrote)
    2. a "source of truth": the facts that message is ALLOWED to state
       (the real balance, the real due date, the real account number, etc.)
  GroundLock returns PASS or BLOCK, plus a signed receipt anyone can re-verify.

  It BLOCKS the message if it finds any of these:
    - a fabricated fact: a dollar amount, date, percentage, or registered code
      (like an account number) that is NOT in your source of truth
    - a missing required fact (the message left out something it must include)
    - a forbidden pattern (for example an invented legal citation)
  Otherwise it PASSES and issues a cryptographically signed proof.

  The point: an AI literally cannot send a fabricated number, date, or code
  past it, and you get court/auditor-ready proof of every message.

WHAT THIS SCRIPT DOES:
  1. checks Node.js and npm are installed
  2. installs dependencies if needed (npm install)
  3. runs the core test suite once, as proof the engine works (skip: --skip-tests)
  4. starts the web playground and opens it in your browser

USAGE:
  python launch.py                 # install if needed, test, then open the playground
  python launch.py --skip-tests    # skip the test run, just open the playground
  python launch.py --port 3005     # use a different port
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
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IS_WIN = os.name == "nt"


def have(cmd: str) -> bool:
    """True if a command is on PATH (also checks the .cmd shim on Windows)."""
    return shutil.which(cmd) is not None or (
        IS_WIN and shutil.which(cmd + ".cmd") is not None
    )


def npm_argv(args: list[str]) -> list[str]:
    """Build an npm command line. On Windows, route through cmd.exe so the npm.cmd
    shim resolves, without enabling the shell: every argument is passed as a fixed
    list element, so there is no shell metacharacter interpretation or injection."""
    return ["cmd", "/c", "npm", *args] if IS_WIN else ["npm", *args]


def run_npm(args: list[str]) -> int:
    """Run an npm command from the repo root."""
    argv = npm_argv(args)
    print("\n> " + " ".join(argv) + "\n", flush=True)
    return subprocess.run(argv, cwd=str(ROOT)).returncode


def start_dev_server(env: dict[str, str]) -> subprocess.Popen:
    """Start the Next.js playground dev server as a child process."""
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if IS_WIN else 0
    return subprocess.Popen(
        npm_argv(["run", "dev", "--workspace", "@groundlock/web"]),
        cwd=str(ROOT),
        env=env,
        creationflags=flags,
    )


def stop_dev_server(proc: subprocess.Popen) -> None:
    """Stop the dev server and any child processes it spawned (no shell)."""
    try:
        if IS_WIN:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True
            )
        else:
            proc.terminate()
    except Exception:
        pass


def wait_for_server(url: str, timeout: float = 120.0) -> bool:
    """Poll the URL until it responds (Next compiles on the first request)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status < 500:
                    return True
        except Exception:
            time.sleep(0.7)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Launch GroundLock locally so you can test it."
    )
    parser.add_argument(
        "--port",
        type=int,
        default=3000,
        help="port for the web playground (default 3000)",
    )
    parser.add_argument(
        "--skip-tests", action="store_true", help="do not run the core test suite first"
    )
    parser.add_argument(
        "--skip-install", action="store_true", help="do not run npm install"
    )
    args = parser.parse_args()

    print(__doc__)

    if not have("node") or not have("npm"):
        print("ERROR: Node.js and npm are required but were not found on PATH.")
        print("Install Node 20+ from https://nodejs.org and re-run: python launch.py")
        return 1

    # 1. Dependencies.
    if args.skip_install:
        print("Skipping npm install (--skip-install).")
    elif (ROOT / "node_modules").exists():
        print(
            "Dependencies already installed (node_modules present). Skipping npm install."
        )
    else:
        if run_npm(["install"]) != 0:
            print("\nERROR: npm install failed. See the output above.")
            return 1

    # 2. Proof the engine works.
    if args.skip_tests:
        print("Skipping the test run (--skip-tests).")
    else:
        if run_npm(["test"]) == 0:
            print("\nCore engine tests passed. The guarantee is working.")
        else:
            print(
                "\nWARNING: not all core tests passed. Starting the playground anyway."
            )

    # 3. Web playground.
    url = "http://localhost:" + str(args.port)
    env = os.environ.copy()
    env["PORT"] = str(args.port)

    print("\nStarting the GroundLock playground. It will open at " + url)
    print("First load can take a few seconds while Next.js compiles.")
    print("Press Ctrl+C in this window to stop the server.\n")

    proc = start_dev_server(env)
    try:
        if wait_for_server(url):
            print("\nGroundLock is up. Opening " + url + " in your browser.")
            print("\nTRY THIS:")
            print("  1. Click 'Load fabricating example', then click 'Verify'.")
            print("     Watch it BLOCK the fake $250 late fee, the wrong date, and the")
            print(
                "     invented 'section 12' citation, and still sign a proof receipt."
            )
            print("  2. Click 'Load clean example', then 'Verify' to see a green PASS.")
            print(
                "  3. Note the 'signature re-verified in your browser' line: the receipt"
            )
            print("     is checked client-side, proving anyone can re-verify it.\n")
            webbrowser.open(url)
        else:
            print("\nThe server did not respond at " + url + " within the timeout.")
            print(
                "It may still be compiling. Try opening "
                + url
                + " manually, or check the logs above."
            )
        proc.wait()
    except KeyboardInterrupt:
        print("\nStopping the server...")
    finally:
        stop_dev_server(proc)
    return 0


if __name__ == "__main__":
    sys.exit(main())
