import { afterEach, describe, expect, it, vi } from "vitest";
import { generateSigningKey } from "@groundlock/core";

const originalKey = process.env.GROUNDLOCK_SIGNING_KEY_JWK;
const originalKid = process.env.GROUNDLOCK_SIGNING_KID;

afterEach(() => {
  if (originalKey === undefined) delete process.env.GROUNDLOCK_SIGNING_KEY_JWK;
  else process.env.GROUNDLOCK_SIGNING_KEY_JWK = originalKey;
  if (originalKid === undefined) delete process.env.GROUNDLOCK_SIGNING_KID;
  else process.env.GROUNDLOCK_SIGNING_KID = originalKid;
  vi.resetModules();
});

describe("web signing key loading", () => {
  it("derives a public JWK without leaking private members from env-configured keys", async () => {
    const key = generateSigningKey("configured-key");
    process.env.GROUNDLOCK_SIGNING_KEY_JWK = JSON.stringify({
      ...key.privateKeyJwk,
      secret_extra: "must-not-leak",
    });
    process.env.GROUNDLOCK_SIGNING_KID = "configured-key";
    vi.resetModules();

    const { getSigningKey } = await import("../lib/signing");
    const loaded = getSigningKey();

    expect(loaded.kid).toBe("configured-key");
    expect(loaded.privateKeyJwk).toEqual(key.privateKeyJwk);
    expect(loaded.publicKeyJwk).toEqual(key.publicKeyJwk);
    expect(JSON.stringify(loaded.publicKeyJwk)).not.toContain("must-not-leak");
    expect(JSON.stringify(loaded.publicKeyJwk)).not.toContain("\"d\"");
  });
});
