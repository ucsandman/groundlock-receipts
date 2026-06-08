import { describe, expect, it } from "vitest";
import {
  SECURITY_HEADERS,
  securityHeadersForEnvironment,
} from "../lib/security-headers";

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
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("connect-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("upgrade-insecure-requests");
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
    expect(headers["Content-Security-Policy"]).not.toContain("localhost");
  });

  it("keeps local development compatible with Next hot reload without weakening production headers", () => {
    const production = Object.fromEntries(
      securityHeadersForEnvironment("production").map((header) => [
        header.key,
        header.value,
      ]),
    );
    const development = Object.fromEntries(
      securityHeadersForEnvironment("development").map((header) => [
        header.key,
        header.value,
      ]),
    );
    const staticProduction = Object.fromEntries(
      SECURITY_HEADERS.map((header) => [header.key, header.value]),
    );

    expect(production["Content-Security-Policy"]).toBe(
      staticProduction["Content-Security-Policy"],
    );
    expect(production["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
    expect(development["Content-Security-Policy"]).toContain("'unsafe-eval'");
    expect(development["Content-Security-Policy"]).toContain("ws://localhost:*");
    expect(development["Content-Security-Policy"]).not.toContain("upgrade-insecure-requests");
  });
});
