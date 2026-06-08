import { afterEach, describe, expect, it } from "vitest";

const originalEnv = {
  GROUNDLOCK_SIGNER_DOMAIN: process.env.GROUNDLOCK_SIGNER_DOMAIN,
  GROUNDLOCK_DOH_ENDPOINT: process.env.GROUNDLOCK_DOH_ENDPOINT,
  GROUNDLOCK_STATUS_BASE_URL: process.env.GROUNDLOCK_STATUS_BASE_URL,
  GROUNDLOCK_STATUS_RECORDS_JSON: process.env.GROUNDLOCK_STATUS_RECORDS_JSON,
};

afterEach(() => {
  restoreEnv("GROUNDLOCK_SIGNER_DOMAIN", originalEnv.GROUNDLOCK_SIGNER_DOMAIN);
  restoreEnv("GROUNDLOCK_DOH_ENDPOINT", originalEnv.GROUNDLOCK_DOH_ENDPOINT);
  restoreEnv("GROUNDLOCK_STATUS_BASE_URL", originalEnv.GROUNDLOCK_STATUS_BASE_URL);
  restoreEnv("GROUNDLOCK_STATUS_RECORDS_JSON", originalEnv.GROUNDLOCK_STATUS_RECORDS_JSON);
});

describe("health route", () => {
  it("reports demo mode as ready without exposing config values", async () => {
    delete process.env.GROUNDLOCK_SIGNER_DOMAIN;
    delete process.env.GROUNDLOCK_DOH_ENDPOINT;
    delete process.env.GROUNDLOCK_STATUS_BASE_URL;
    delete process.env.GROUNDLOCK_STATUS_RECORDS_JSON;

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      service: "groundlock-web",
      ok: true,
      mode: "demo",
      checks: {
        signerDomainConfigured: false,
        dohEndpointConfigured: false,
        statusBaseUrlConfigured: false,
        statusRecordsConfigured: false,
      },
    });
  });

  it("fails live mode health when required status config is missing", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    delete process.env.GROUNDLOCK_STATUS_BASE_URL;

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual(expect.objectContaining({
      service: "groundlock-web",
      ok: false,
      mode: "live",
      code: "missing_status_base_url",
    }));
    expect(JSON.stringify(body)).not.toContain("publisher.example");
  });

  it("reports live mode as ready when required config is present", async () => {
    process.env.GROUNDLOCK_SIGNER_DOMAIN = "publisher.example";
    process.env.GROUNDLOCK_DOH_ENDPOINT = "https://resolver.example/dns-query";
    process.env.GROUNDLOCK_STATUS_BASE_URL = "https://publisher.example/groundlock/status";
    process.env.GROUNDLOCK_STATUS_RECORDS_JSON = "[]";

    const route = await import("../app/api/health/route");
    const response = await route.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      service: "groundlock-web",
      ok: true,
      mode: "live",
      checks: {
        signerDomainConfigured: true,
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
