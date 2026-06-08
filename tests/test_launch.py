import importlib.util
import sys
import unittest
from pathlib import Path


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
        )

        self.assertEqual(launch.preflight_steps(args, dependencies_installed=False), [])


if __name__ == "__main__":
    unittest.main()
