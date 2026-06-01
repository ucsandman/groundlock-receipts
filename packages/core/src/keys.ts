import { generateKeyPairSync, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

export interface KeyPairJwk {
  kid: string;
  privateKeyJwk: JsonWebKey;
  publicKeyJwk: JsonWebKey;
}

export function generateSigningKey(kid: string): KeyPairJwk {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    kid,
    privateKeyJwk: privateKey.export({ format: "jwk" }) as JsonWebKey,
    publicKeyJwk: publicKey.export({ format: "jwk" }) as JsonWebKey,
  };
}

export function privateKeyFromJwk(jwk: JsonWebKey): KeyObject {
  return createPrivateKey({ key: jwk as object, format: "jwk" });
}

export function publicKeyFromJwk(jwk: JsonWebKey): KeyObject {
  return createPublicKey({ key: jwk as object, format: "jwk" });
}
