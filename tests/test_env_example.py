import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ENV_EXAMPLE = ROOT / ".env.example"


class EnvExampleTests(unittest.TestCase):
    def test_env_example_lists_public_launch_configuration_without_secrets(
        self,
    ) -> None:
        text = ENV_EXAMPLE.read_text(encoding="utf-8")
        values = commented_env_values(text)

        required = {
            "PORT",
            "NEXT_PUBLIC_SITE_URL",
            "GROUNDLOCK_SIGNER_DOMAIN",
            "GROUNDLOCK_DOH_ENDPOINT",
            "GROUNDLOCK_STATUS_BASE_URL",
            "GROUNDLOCK_FETCH_TIMEOUT_MS",
            "GROUNDLOCK_STATUS_RECORDS_JSON",
            "GROUNDLOCK_RATE_LIMIT_MAX",
            "GROUNDLOCK_RATE_LIMIT_WINDOW_MS",
        }
        self.assertEqual(required - values.keys(), set())
        self.assertNotRegex(
            text,
            re.compile(
                r"BEGIN (RSA|OPENSSH|PRIVATE)|\.private\.jwk|\"d\"\s*:",
                re.I,
            ),
        )
        self.assert_positive_int(values["GROUNDLOCK_FETCH_TIMEOUT_MS"])
        self.assert_positive_int(values["GROUNDLOCK_RATE_LIMIT_MAX"])
        self.assert_positive_int(values["GROUNDLOCK_RATE_LIMIT_WINDOW_MS"])

    def test_status_records_example_contains_key_and_claim_records(self) -> None:
        values = commented_env_values(ENV_EXAMPLE.read_text(encoding="utf-8"))
        records = json.loads(values["GROUNDLOCK_STATUS_RECORDS_JSON"])

        self.assertIsInstance(records, list)
        self.assertEqual({record["kind"] for record in records}, {"key", "claim"})
        claim = next(record for record in records if record["kind"] == "claim")
        self.assertRegex(claim["subject"]["receiptHash"], r"^sha256:.+")

    def assert_positive_int(self, value: str) -> None:
        parsed = int(value)
        self.assertGreater(parsed, 0)
        self.assertEqual(str(parsed), value)


def commented_env_values(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line.startswith("# "):
            continue
        candidate = line[2:].strip()
        if "=" not in candidate:
            continue
        key, value = candidate.split("=", 1)
        values[key.strip()] = value.strip()
    return values


if __name__ == "__main__":
    unittest.main()
