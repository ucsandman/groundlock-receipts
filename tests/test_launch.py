import importlib.util
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
LAUNCH_PATH = ROOT / "launch.py"
spec = importlib.util.spec_from_file_location("groundlock_launch", LAUNCH_PATH)
assert spec is not None
launch = importlib.util.module_from_spec(spec)
sys.modules["groundlock_launch"] = launch
assert spec.loader is not None
spec.loader.exec_module(launch)


class LaunchScriptTests(unittest.TestCase):
    def test_dev_server_argv_forwards_host_and_port_to_next(self) -> None:
        argv = launch.dev_server_argv(host="127.0.0.1", port=4321)

        self.assertIn("run", argv)
        self.assertIn("dev", argv)
        self.assertIn("--workspace", argv)
        self.assertIn("@groundlock/web", argv)
        self.assertIn("--", argv)
        self.assertIn("--hostname", argv)
        self.assertIn("127.0.0.1", argv)
        self.assertIn("--port", argv)
        self.assertIn("4321", argv)

    def test_browser_url_uses_loopback_when_server_binds_all_interfaces(self) -> None:
        self.assertEqual(launch.browser_url("0.0.0.0", 3007), "http://127.0.0.1:3007")

    def test_preflight_steps_are_fail_fast_and_ordered(self) -> None:
        args = launch.LaunchOptions(
            host="127.0.0.1",
            port=3000,
            skip_install=False,
            skip_build=False,
            skip_tests=False,
            no_browser=True,
            exit_after_ready=False,
        )

        self.assertEqual(
            launch.preflight_steps(args, dependencies_installed=False),
            [
                ("install dependencies", ["install"]),
                ("build packages", ["run", "build"]),
                ("run tests", ["test"]),
            ],
        )

    def test_preflight_respects_skip_flags(self) -> None:
        args = launch.LaunchOptions(
            host="127.0.0.1",
            port=3000,
            skip_install=True,
            skip_build=True,
            skip_tests=True,
            no_browser=True,
            exit_after_ready=False,
        )

        self.assertEqual(launch.preflight_steps(args, dependencies_installed=False), [])

    def test_find_available_port_skips_occupied_port(self) -> None:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(1)
            occupied_port = listener.getsockname()[1]

            selected_port = launch.find_available_port("127.0.0.1", occupied_port)

        self.assertGreater(selected_port, occupied_port)

    def test_wait_for_server_rejects_non_groundlock_pages(self) -> None:
        class FakeResponse:
            status = 200

            def __enter__(self) -> "FakeResponse":
                return self

            def __exit__(self, *_args: object) -> None:
                return None

            def read(self, _limit: int = -1) -> bytes:
                return b"<html><title>DashClaw</title></html>"

        with (
            patch.object(launch.time, "sleep", return_value=None),
            patch.object(launch.urllib.request, "urlopen", return_value=FakeResponse()),
        ):
            self.assertFalse(
                launch.wait_for_server("http://127.0.0.1:3000", timeout=0.01)
            )

    def test_file_snapshot_restore_puts_generated_files_back(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "next-env.d.ts"
            path.write_text("before\r\n", encoding="utf-8", newline="")

            snapshot = launch.snapshot_file(path)
            path.write_text("after\r\n", encoding="utf-8", newline="")
            launch.restore_file_snapshot(path, snapshot)

            with path.open("r", encoding="utf-8", newline="") as handle:
                self.assertEqual(handle.read(), "before\r\n")

    def test_file_snapshot_restore_removes_file_created_during_launch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "next-env.d.ts"

            snapshot = launch.snapshot_file(path)
            path.write_text("created\r\n", encoding="utf-8", newline="")
            launch.restore_file_snapshot(path, snapshot)

            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
