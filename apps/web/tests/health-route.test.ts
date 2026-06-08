import { afterEach, describe, expect, it } from "vitest";

const originalEnv = {
  GROUNDLOCK_SIGNER_DOMAIN: process.env.GROUNDLOCK_SIGNER_DOMAIN,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  GROUNDLOCK_DOH_ENDPOINT: process.env.GROUNDLOCK_DOH_ENDPOINT,
  GROUNDLOCK_STATUS_BASE_URL: process.env.GROUNDLOCK_STATUS_BASE_URL,
  GROUNDLOCK_STATUS_RECORDS_JSON: process.env.GROUNDLOCK_STATUS_RECORDS_JSON,
  GROUNDLOCK_FETCH_TIMEOUT_MS: process.env.GROUNDLOCK_FETCH_TIMEOUT_MS,
};

afterEach(() => {
  restoreEnv("GROUNDLOCK_SIGNER_DOMAIN", originalEnv.GROUNDLOCK_SIGNER_DOMAIN);
  restoreEnv("NEXT_PUBLIC_SITE_URL", originalEnv.NEXT_PUBLIC_SITE_URL);
  restoreEnv("GROUNDLOCK_DOH_ENDPOINT", originalEnv.GROUNDLOCK_DOH_ENDPOINT);
  restoreEnv("GROUNDLOCK_STATUS_BASE_URL", originalEnv.GROUNDLOCK_STATUS_BASE_URL);
  restoreEnv("GROUNDLOCK_STATUS_RECORDS_JSON", originalEnv.GROUNDLOCK_STATUS_RECORDS_JSON);
  restoreEnv("GROUNDLOCK_FETCH_TIMEOUT_MS", originalEnv.GROUNDLOCK_FETCH_TIMEOUT_MS);
});

describe("health route", () => {
  it("reports demo mode as ready without exposing config values", async () => {
    delete process.env.GROUNDLOCK_SIGNER_DOMAIN;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.GROUNDLOCK_DOH_ENDPOINT;
    delete process.env.GROUNDLOCK_STATUS_BASE_URL;
    delete process.env.GROUNDLOCK_STATUS_RECORDS_JSON;

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      service: "groundlock-web",
      ok: true,
      mode: "demo",
      checks: {
        signerDomainConfigured: false,
        siteUrlConfigured: false,
        dohEndpointConfigured: false,
        statusBaseUrlConfigured: false,
        statusRecordsConfigured: false,
      },
    });
  });

  it("fails live mode health when required status config is missing", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";
    delete process.env.GROUNDLOCK_STATUS_BASE_URL;

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: false,
      mode: "live",
      code: "missing_status_base_url",
    }));
    expect(JSON.stringify(body)).not.toContain("publisher.example");
  });

  it("fails live mode health when explicit DoH config is missing", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";
    delete process.env.GROUNDLOCK_DOH_ENDPOINT;
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://publisher.example/groundlock/status";

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: false,
      mode: "live",
      code: "missing_doh_endpoint",
    }));
    expect(JSON.stringify(body)).not.toContain("publisher.example");
  });

  it.each([
    ["site URL", "NEXT_PUBLIC_SITE_URL", "not-url", "invalid_site_url"],
    ["site URL", "NEXT_PUBLIC_SITE_URL", "https://user:pass@receipts.groundlock.dev", "invalid_site_url"],
    ["site URL", "NEXT_PUBLIC_SITE_URL", "https://bad_label.groundlock.dev", "invalid_site_url"],
    ["site URL", "NEXT_PUBLIC_SITE_URL", "https://127.0.0.1", "invalid_site_url"],
    ["site URL", "NEXT_PUBLIC_SITE_URL", "https://receipts.groundlock.dev/?preview=1", "invalid_site_url"],
    ["DoH endpoint", "GROUNDLOCK_DOH_ENDPOINT", "http://resolver.example/dns-query", "invalid_doh_endpoint"],
    ["DoH endpoint", "GROUNDLOCK_DOH_ENDPOINT", "https://user:pass@resolver.example/dns-query", "invalid_doh_endpoint"],
    ["DoH endpoint", "GROUNDLOCK_DOH_ENDPOINT", "https://bad_label.example/dns-query", "invalid_doh_endpoint"],
    ["DoH endpoint", "GROUNDLOCK_DOH_ENDPOINT", "https://resolver.example/dns-query?bootstrap=1", "invalid_doh_endpoint"],
    ["status base URL", "GROUNDLOCK_STATUS_BASE_URL", "not-url", "invalid_status_base_url"],
    ["status base URL", "GROUNDLOCK_STATUS_BASE_URL", "https://publisher.example/groundlock/status#fragment", "invalid_status_base_url"],
  ])("fails live mode health when %s config is invalid", async (_label, key, value, code) => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://publisher.example/groundlock/status";
    process.env[key] = value;

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: false,
      mode: "live",
      code,
    }));
    expect(JSON.stringify(body)).not.toContain(value);
  });

  it("fails live mode health when the external fetch timeout is invalid", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://publisher.example/groundlock/status";
    process.env.GROUNDLOCK_FETCH_TIMEOUT_MS = "0";

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: false,
      mode: "live",
      code: "invalid_fetch_timeout",
    }));
    expect(JSON.stringify(body)).not.toContain("resolver.example");
  });

  it("fails live mode health when bundled same-origin status records are missing", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev/app";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://receipts.groundlock.dev/groundlock/status";
    delete process.env.GROUNDLOCK_STATUS_RECORDS_JSON;

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: false,
      mode: "live",
      code: "missing_status_records",
    }));
    expect(JSON.stringify(body)).not.toContain("receipts.groundlock.dev");
  });

  it("fails live mode health when bundled same-origin status records are malformed", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://receipts.groundlock.dev/groundlock/status";
    process.env.GROUNDLOCK_STATUS_RECORDS_JSON = "not-json";

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: false,
      mode: "live",
      code: "status_records_malformed",
    }));
    expect(JSON.stringify(body)).not.toContain("not-json");
  });

  it("fails live mode health when any bundled same-origin status record has malformed shape", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://receipts.groundlock.dev/groundlock/status";
    process.env.GROUNDLOCK_STATUS_RECORDS_JSON = JSON.stringify([
      {
        version: "groundlock-status/v1",
        kind: "key",
        subject: { signerDomain: "publisher.example", kid: "k1" },
        status: "active",
        issuedAt: "2026-06-08T00:00:00.000Z",
      },
      {
        version: "groundlock-status/v1",
        kind: "claim",
        subject: { receiptHash: "sha256:abc123" },
        status: "active",
      },
    ]);

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: false,
      mode: "live",
      code: "status_records_malformed",
    }));
    expect(JSON.stringify(body)).not.toContain("publisher.example");
  });

  it("fails live mode health when bundled same-origin status records lack a key or claim record", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://receipts.groundlock.dev/groundlock/status";
    process.env.GROUNDLOCK_STATUS_RECORDS_JSON = JSON.stringify([
      {
        version: "groundlock-status/v1",
        kind: "key",
        subject: { signerDomain: "publisher.example", kid: "k1" },
        status: "active",
        issuedAt: "2026-06-08T00:00:00.000Z",
      },
    ]);

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: false,
      mode: "live",
      code: "status_records_incomplete",
    }));
    expect(JSON.stringify(body)).not.toContain("publisher.example");
  });

  it("fails live mode health when bundled key status is for a different signer domain", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://receipts.groundlock.dev/groundlock/status";
    process.env.GROUNDLOCK_STATUS_RECORDS_JSON = JSON.stringify([
      {
        version: "groundlock-status/v1",
        kind: "key",
        subject: { signerDomain: "other.example", kid: "k1" },
        status: "active",
        issuedAt: "2026-06-08T00:00:00.000Z",
      },
      {
        version: "groundlock-status/v1",
        kind: "claim",
        subject: { receiptHash: "sha256:abc123" },
        status: "active",
        issuedAt: "2026-06-08T00:00:00.000Z",
      },
    ]);

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: false,
      mode: "live",
      code: "status_records_incomplete",
    }));
    expect(JSON.stringify(body)).not.toContain("other.example");
  });

  it("fails live mode health when bundled same-origin status records are not active", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://receipts.groundlock.dev/groundlock/status";
    process.env.GROUNDLOCK_STATUS_RECORDS_JSON = JSON.stringify([
      {
        version: "groundlock-status/v1",
        kind: "key",
        subject: { signerDomain: "publisher.example", kid: "k1" },
        status: "revoked",
        issuedAt: "2026-06-08T00:00:00.000Z",
      },
      {
        version: "groundlock-status/v1",
        kind: "claim",
        subject: { receiptHash: "sha256:abc123" },
        status: "revoked",
        issuedAt: "2026-06-08T00:00:00.000Z",
      },
    ]);

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: false,
      mode: "live",
      code: "status_records_incomplete",
    }));
    expect(JSON.stringify(body)).not.toContain("publisher.example");
  });

  it("allows externally managed status records without bundled status JSON", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://publisher.example/groundlock/status";
    delete process.env.GROUNDLOCK_STATUS_RECORDS_JSON;

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: true,
      mode: "live",
      checks: expect.objectContaining({
        statusBaseUrlConfigured: true,
        statusRecordsConfigured: false,
      }),
    }));
  });

  it("reports live mode as ready when required config is present", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.NEXT_PUBLIC_SITE_URL = "https://receipts.groundlock.dev";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://receipts.groundlock.dev/groundlock/status";
    process.env.GROUNDLOCK_STATUS_RECORDS_JSON = JSON.stringify([
      {
        version: "groundlock-status/v1",
        kind: "key",
        subject: { signerDomain: "publisher.example", kid: "k1" },
        status: "active",
        issuedAt: "2026-06-08T00:00:00.000Z",
      },
      {
        version: "groundlock-status/v1",
        kind: "claim",
        subject: { receiptHash: "sha256:abc123" },
        status: "active",
        issuedAt: "2026-06-08T00:00:00.000Z",
      },
    ]);

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      service: "groundlock-web",
      ok: true,
      mode: "live",
      checks: {
        signerDomainConfigured: true,
        siteUrlConfigured: true,
        dohEndpointConfigured: true,
        statusBaseUrlConfigured: true,
        statusRecordsConfigured: true,
      },
    });
    expect(JSON.stringify(body)).not.toContain("resolver.example");
  });
});

function restoreEnv(key: keyof typeof originalEnv, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
