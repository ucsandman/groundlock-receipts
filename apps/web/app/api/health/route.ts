import { jsonNoStore } from "../../../lib/http";
import { configuredFetchTimeoutMs } from "../../../lib/fetch-timeout";
import { configuredLaunchHttpsUrl } from "../../../lib/launch-url";
import { configuredRateLimit } from "../../../lib/rate-limit";
import { readStatusRecords } from "../../../lib/status-endpoint";
import type { StatusRecord } from "@groundlock/core";

export const runtime = "nodejs";

type HealthMode = "demo" | "live";

interface HealthChecks {
  signerDomainConfigured: boolean;
  siteUrlConfigured: boolean;
  dohEndpointConfigured: boolean;
  statusBaseUrlConfigured: boolean;
  statusRecordsConfigured: boolean;
}

export function GET() {
  const checks = readHealthChecks();
  const mode: HealthMode = checks.signerDomainConfigured ? "live" : "demo";

  if (mode === "live" && !checks.statusBaseUrlConfigured) {
    return jsonNoStore(
      {
        service: "groundlock-web",
        ok: false,
        mode,
        code: "missing_status_base_url",
        checks,
      },
      { status: 503 },
    );
  }

  if (mode === "live" && !checks.dohEndpointConfigured) {
    return jsonNoStore(
      {
        service: "groundlock-web",
        ok: false,
        mode,
        code: "missing_doh_endpoint",
        checks,
      },
      { status: 503 },
    );
  }

  if (mode === "live" && checks.siteUrlConfigured && !isConfiguredHttpsUrl(process.env.NEXT_PUBLIC_SITE_URL)) {
    return liveConfigError("invalid_site_url", checks);
  }

  if (mode === "live" && !isConfiguredHttpsUrl(process.env.GROUNDLOCK_DOH_ENDPOINT)) {
    return liveConfigError("invalid_doh_endpoint", checks);
  }

  if (mode === "live" && !isConfiguredHttpsUrl(process.env.GROUNDLOCK_STATUS_BASE_URL)) {
    return liveConfigError("invalid_status_base_url", checks);
  }

  if (mode === "live" && configuredFetchTimeoutMs() === null) {
    return liveConfigError("invalid_fetch_timeout", checks);
  }

  if (mode === "live" && configuredRateLimit() === null) {
    return liveConfigError("invalid_rate_limit", checks);
  }

  if (mode === "live" && usesBundledStatusEndpoint() && !checks.statusRecordsConfigured) {
    return jsonNoStore(
      {
        service: "groundlock-web",
        ok: false,
        mode,
        code: "missing_status_records",
        checks,
      },
      { status: 503 },
    );
  }

  if (mode === "live" && usesBundledStatusEndpoint()) {
    const statusRecords = readStatusRecords();
    if (statusRecords.type !== "ok") {
      return jsonNoStore(
        {
          service: "groundlock-web",
          ok: false,
          mode,
          code: statusRecords.code,
          checks,
        },
        { status: statusRecords.status },
      );
    }
    if (!hasUsableBundledStatusRecords(statusRecords.records, process.env.GROUNDLOCK_SIGNER_DOMAIN)) {
      return jsonNoStore(
        {
          service: "groundlock-web",
          ok: false,
          mode,
          code: "status_records_incomplete",
          checks,
        },
        { status: 503 },
      );
    }
  }

  return jsonNoStore({
    service: "groundlock-web",
    ok: true,
    mode,
    checks,
  });
}

function readHealthChecks(): HealthChecks {
  return {
    signerDomainConfigured: isConfigured(process.env.GROUNDLOCK_SIGNER_DOMAIN),
    siteUrlConfigured: isConfigured(process.env.NEXT_PUBLIC_SITE_URL),
    dohEndpointConfigured: isConfigured(process.env.GROUNDLOCK_DOH_ENDPOINT),
    statusBaseUrlConfigured: isConfigured(process.env.GROUNDLOCK_STATUS_BASE_URL),
    statusRecordsConfigured: isConfigured(process.env.GROUNDLOCK_STATUS_RECORDS_JSON),
  };
}

function isConfigured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isConfiguredHttpsUrl(value: string | undefined): boolean {
  return configuredLaunchHttpsUrl(value) !== null;
}

function hasUsableBundledStatusRecords(records: StatusRecord[], signerDomain: string | undefined): boolean {
  const normalizedSignerDomain = normalizeDomain(signerDomain);
  if (!normalizedSignerDomain) return false;
  return hasActiveKeyForSigner(records, normalizedSignerDomain) && hasActiveClaim(records);
}

function hasActiveKeyForSigner(records: StatusRecord[], signerDomain: string): boolean {
  return records.some(
    (record) =>
      record.kind === "key" &&
      record.status === "active" &&
      normalizeDomain(record.subject.signerDomain) === signerDomain &&
      record.subject.kid.trim().length > 0,
  );
}

function hasActiveClaim(records: StatusRecord[]): boolean {
  return records.some(
    (record) =>
      record.kind === "claim" &&
      record.status === "active" &&
      /^sha256:[A-Za-z0-9_-]+$/.test(record.subject.receiptHash),
  );
}

function normalizeDomain(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/\.$/, "").toLowerCase();
  return normalized ? normalized : null;
}

function liveConfigError(code: string, checks: HealthChecks) {
  return jsonNoStore(
    {
      service: "groundlock-web",
      ok: false,
      mode: "live" as const,
      code,
      checks,
    },
    { status: 503 },
  );
}

function usesBundledStatusEndpoint(): boolean {
  const siteOrigin = configuredOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  const statusOrigin = configuredOrigin(process.env.GROUNDLOCK_STATUS_BASE_URL);
  return siteOrigin !== null && statusOrigin !== null && siteOrigin === statusOrigin;
}

function configuredOrigin(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}
