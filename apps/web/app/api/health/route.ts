import { jsonNoStore } from "../../../lib/http";

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
