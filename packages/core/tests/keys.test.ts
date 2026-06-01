import { describe, it, expect } from "vitest";
import { generateSigningKey, privateKeyFromJwk, publicKeyFromJwk } from "../src/keys";

describe("keys", () => {
  it("generates an Ed25519 OKP keypair as JWK", () => {
    const kp = generateSigningKey("k1");
    expect(kp.kid).toBe("k1");
    expect(kp.privateKeyJwk.kty).toBe("OKP");
    expect(kp.privateKeyJwk.crv).toBe("Ed25519");
    expect(typeof kp.privateKeyJwk.d).toBe("string");
    expect(kp.publicKeyJwk.d).toBeUndefined();
  });

  it("imports JWKs into usable key objects", () => {
    const kp = generateSigningKey("k1");
    expect(() => privateKeyFromJwk(kp.privateKeyJwk)).not.toThrow();
    expect(() => publicKeyFromJwk(kp.publicKeyJwk)).not.toThrow();
  });
});
