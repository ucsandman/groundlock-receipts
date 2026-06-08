import { describe, expect, it } from "vitest";
import { SECURITY_HEADERS } from "../lib/security-headers";

describe("security headers", () => {
  it("keeps the public verifier locked down for browser traffic", () => {
    const headers = Object.fromEntries(SECURITY_HEADERS.map((header) => [header.key, header.value]));

    expect(headers).toEqual(
      expect.objectContaining({
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Strict-Transport-Security": "max-age=31536000",
        "Cross-Origin-Opener-Policy": "same-origin",
        "X-DNS-Prefetch-Control": "off",
        "X-Permitted-Cross-Domain-Policies": "none",
      }),
    );
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Permissions-Policy"]).toContain("microphone=()");
    expect(headers["Permissions-Policy"]).toContain("geolocation=()");
    expect(headers["Permissions-Policy"]).toContain("payment=()");
  });
});
