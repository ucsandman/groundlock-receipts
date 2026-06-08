import { generateSigningKey, type KeyPairJwk } from "@groundlock/core";

let cached: KeyPairJwk | null = null;

export function getSigningKey(): KeyPairJwk {
  if (cached) return cached;
  const kid = process.env.GROUNDLOCK_SIGNING_KID ?? "demo-key-1";
  const raw = process.env.GROUNDLOCK_SIGNING_KEY_JWK;
  if (raw) {
    const parsed = parseEd25519PrivateJwk(raw);
    cached = { kid, ...parsed };
  } else {
    cached = generateSigningKey(kid);
  }
  return cached;
}

function parseEd25519PrivateJwk(raw: string): Pick<KeyPairJwk, "privateKeyJwk" | "publicKeyJwk"> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("invalid_signing_key_jwk");
  }
  if (!isRecord(value) || value.kty !== "OKP" || value.crv !== "Ed25519" || !isString(value.x) || !isString(value.d)) {
    throw new Error("invalid_signing_key_jwk");
  }
  return {
    privateKeyJwk: { kty: "OKP", crv: "Ed25519", x: value.x, d: value.d },
    publicKeyJwk: { kty: "OKP", crv: "Ed25519", x: value.x },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
