import { describe, expect, it } from "vitest";
import { POST } from "../app/api/verify/route";
import { RATE_LIMIT_MAX, demoInputs, MAX_VERIFY_BYTES } from "../lib/public-verifier";

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
    await expect(postJson({ candidate: "hello", sourceOfTruth: {} })).resolves.toEqual(
      expect.objectContaining({ response: expect.objectContaining({ status: 400 }) }),
    );
  });

  it("does not let spoofed forwarding headers bypass the public rate limit", async () => {
    let last: Awaited<ReturnType<typeof postJson>> | undefined;
    for (let i = 0; i < RATE_LIMIT_MAX + 1; i++) {
      last = await postJson({ hash: `sha256:rateLimit${i}` }, { "x-forwarded-for": `203.0.113.${i}` });
    }
    expect(last?.response.status).toBe(429);
    expect(last?.json).toEqual(expect.objectContaining({ state: "UNVERIFIABLE", code: "rate_limited" }));
  });
});
