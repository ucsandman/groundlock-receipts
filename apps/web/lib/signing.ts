import { generateSigningKey, type KeyPairJwk } from "@groundlock/core";

let cached: KeyPairJwk | null = null;

export function getSigningKey(): KeyPairJwk {
  if (cached) return cached;
  const kid = process.env.GROUNDLOCK_SIGNING_KID ?? "demo-key-1";
  const raw = process.env.GROUNDLOCK_SIGNING_KEY_JWK;
  if (raw) {
    const privateKeyJwk = JSON.parse(raw) as JsonWebKey;
    // Public JWK for OKP is the private JWK without the private scalar "d".
    const { d: _d, ...publicKeyJwk } = privateKeyJwk as JsonWebKey & { d?: string };
    cached = { kid, privateKeyJwk, publicKeyJwk: publicKeyJwk as JsonWebKey };
  } else {
    cached = generateSigningKey(kid);
  }
  return cached;
}
