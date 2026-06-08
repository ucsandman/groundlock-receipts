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
        self.assertIn("docker run", workflow)
        self.assertIn("/api/health", workflow)


if __name__ == "__main__":
    unittest.main()
