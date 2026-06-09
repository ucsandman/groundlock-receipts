import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_SMOKE_ROUTES = (
    "/",
    "/groundlock-receipt-desk.png",
    "/robots.txt",
    "/sitemap.xml",
    "/api/health",
    "/api/verify",
)


class DocsLaunchContractTests(unittest.TestCase):
    def test_readme_describes_public_ci_smoke_surface(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")

        self.assertIn("CI smoke-tests the built image", readme)
        for route in PUBLIC_SMOKE_ROUTES:
            self.assertIn(route, readme)
        self.assertIn("same-origin key/claim status endpoints", readme)
        self.assertIn("production security-header contract", readme)

    def test_deployment_docs_describe_public_ci_smoke_surface(self) -> None:
        deployment = (ROOT / "docs" / "deployment.md").read_text(encoding="utf-8")

        self.assertIn("scripts/smoke_web_response.mjs", deployment)
        for route in PUBLIC_SMOKE_ROUTES:
            self.assertIn(route, deployment)
        self.assertIn("share image is served as `image/png` with PNG bytes", deployment)
        self.assertIn("key/claim status endpoints", deployment)


if __name__ == "__main__":
    unittest.main()
