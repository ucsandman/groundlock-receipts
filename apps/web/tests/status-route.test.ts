import { afterEach, describe, expect, it } from "vitest";
import { createClaimStatusRecord, createKeyStatusRecord } from "@groundlock/core";

const originalRecords = process.env.GROUNDLOCK_STATUS_RECORDS_JSON;

afterEach(() => {
  if (originalRecords === undefined) delete process.env.GROUNDLOCK_STATUS_RECORDS_JSON;
  else process.env.GROUNDLOCK_STATUS_RECORDS_JSON = originalRecords;
});

describe("public status routes", () => {
  it("serves key and claim status records by public lookup", async () => {
    const keyStatus = createKeyStatusRecord({
      signerDomain: "publisher.example",
      kid: "k1",
      status: "active",
      issuedAt: "2026-06-08T00:00:00.000Z",
    });
    const claimStatus = createClaimStatusRecord({
      receiptHash: "sha256:abc123",
      status: "active",
      issuedAt: "2026-06-08T00:00:00.000Z",
    });
    process.env.GROUNDLOCK_STATUS_RECORDS_JSON = JSON.stringify([keyStatus, claimStatus]);

    const keyRoute = await import("../app/groundlock/status/key/route");
    const claimRoute = await import("../app/groundlock/status/claim/route");

    const keyResponse = await keyRoute.GET(new Request("http://localhost/groundlock/status/key?lookup=key:publisher.example:k1"));
    const claimResponse = await claimRoute.GET(new Request("http://localhost/groundlock/status/claim?lookup=claim:sha256:abc123"));

    expect(keyResponse.status).toBe(200);
    expect(keyResponse.headers.get("cache-control")).toBe("no-store");
    expect(await keyResponse.json()).toEqual(keyStatus);
    expect(claimResponse.status).toBe(200);
    expect(claimResponse.headers.get("cache-control")).toBe("no-store");
    expect(await claimResponse.json()).toEqual(claimStatus);
  });

  it("fails closed for missing config, missing lookup, and unknown records", async () => {
    const keyRoute = await import("../app/groundlock/status/key/route");
    let response = await keyRoute.GET(new Request("http://localhost/groundlock/status/key?lookup=key:publisher.example:k1"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "status_records_not_configured" });

    process.env.GROUNDLOCK_STATUS_RECORDS_JSON = JSON.stringify([]);
    response = await keyRoute.GET(new Request("http://localhost/groundlock/status/key"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "missing_lookup" });

    response = await keyRoute.GET(new Request("http://localhost/groundlock/status/key?lookup=key:publisher.example:k1"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "status_not_found" });
  });

  it("fails closed for malformed bundled status records", async () => {
    process.env.GROUNDLOCK_STATUS_RECORDS_JSON = "not-json";
    const keyRoute = await import("../app/groundlock/status/key/route");

    const response = await keyRoute.GET(new Request("http://localhost/groundlock/status/key?lookup=key:publisher.example:k1"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "status_records_malformed" });
  });
});
