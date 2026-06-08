import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "../app/api/verify/route";
import { RATE_LIMIT_MAX, demoInputs, MAX_VERIFY_BYTES } from "../lib/public-verifier";
import { resetPublicVerifierRateLimitForTest } from "../lib/rate-limit";

async function postJson(body: unknown, headers: Record<string, string> = {}) {
  const response = await POST(
    new Request("http://localhost/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
  return { response, json: await response.json() };
}

describe("public verifier route", () => {
  beforeEach(() => {
    resetPublicVerifierRateLimitForTest();
  });

  afterEach(() => {
    resetPublicVerifierRateLimitForTest();
  });

  it("returns PASS, BLOCK, REVOKED, and UNVERIFIABLE public states", async () => {
    const inputs = demoInputs();

    await expect(postJson({ fileText: inputs.passText })).resolves.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ status: 200 }), json: expect.objectContaining({ state: "PASS", code: "verified" }) }),
    );
    await expect(postJson({ fileText: inputs.blockText })).resolves.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ status: 200 }), json: expect.objectContaining({ state: "BLOCK", code: "receipt_blocked" }) }),
    );
    await expect(postJson({ fileText: inputs.revokedText })).resolves.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ status: 200 }), json: expect.objectContaining({ state: "REVOKED", code: "status_revoked" }) }),
    );
    await expect(postJson({ hash: "sha256:unknownhashvalue" })).resolves.toEqual(
      expect.objectContaining({
        response: expect.objectContaining({ status: 200 }),
        json: expect.objectContaining({ state: "UNVERIFIABLE", code: "dns_txt_missing" }),
      }),
    );
  });

  it("rejects ambiguous, remote, oversized, and malformed public inputs", async () => {
    const inputs = demoInputs();

    await expect(postJson({ fileText: inputs.passText, hash: inputs.passHash })).resolves.toEqual(
      expect.objectContaining({
        response: expect.objectContaining({ status: 400 }),
        json: expect.objectContaining({ state: "UNVERIFIABLE", code: "ambiguous_input" }),
      }),
    );
    await expect(postJson({ url: "https://example.com/message.txt" })).resolves.toEqual(
      expect.objectContaining({
        response: expect.objectContaining({ status: 400 }),
        json: expect.objectContaining({ state: "UNVERIFIABLE", code: "remote_url_not_allowed" }),
      }),
    );
    await expect(postJson({ fileText: "x".repeat(MAX_VERIFY_BYTES + 1) })).resolves.toEqual(
      expect.objectContaining({
        response: expect.objectContaining({ status: 413 }),
        json: expect.objectContaining({ state: "UNVERIFIABLE", code: "payload_too_large" }),
      }),
    );
    await expect(postJson({})).resolves.toEqual(
      expect.objectContaining({
        response: expect.objectContaining({ status: 400 }),
        json: expect.objectContaining({ state: "UNVERIFIABLE", code: "missing_public_input" }),
      }),
    );
  });

  it("does not issue signed receipts from the public verifier", async () => {
    const result = await postJson({
      candidate: "Dear Jane Roe, return $2,000.00.",
      sourceOfTruth: {
        requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
        allowedFacts: [{ label: "amount", value: "$2,000.00" }],
      },
    });

    expect(result.response.status).toBe(403);
    expect(result.json).toEqual(
      expect.objectContaining({ state: "UNVERIFIABLE", code: "public_signing_not_supported" }),
    );
    expect(JSON.stringify(result.json)).not.toContain("privateKeyJwk");
    expect(JSON.stringify(result.json)).not.toContain("publicKeyJwk");
    expect(JSON.stringify(result.json)).not.toContain("\"receipt\"");
  });

  it("does not let spoofed forwarding headers bypass the public rate limit", async () => {
    let last: Awaited<ReturnType<typeof postJson>> | undefined;
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i++) {
      last = await postJson({ hash: `sha256:rateLimit${i}` }, { "x-forwarded-for": `203.0.113.${i}` });
    }
    expect(last?.response.status).toBe(429);
    expect(Number(last?.response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(last?.json).toEqual(expect.objectContaining({ state: "UNVERIFIABLE", code: "rate_limited" }));
  });
});
