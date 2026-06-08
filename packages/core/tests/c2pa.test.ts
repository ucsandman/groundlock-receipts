import { describe, expect, it } from "vitest";
import {
  C2PA_INTEROP_TARGET,
  createC2paInteropSidecar,
  digestJson,
  generateSigningKey,
  issueVerifiedReceipt,
  receiptStatusHash,
  verifyReceipt,
  type SourceOfTruth,
} from "../src/index";

const source: SourceOfTruth = {
  requiredFacts: [{ label: "tenant", value: "Jane Roe" }],
  allowedFacts: [{ label: "amount", value: "$2,000.00" }],
  extract: { money: true, dates: false, percentages: false },
};

describe("C2PA interop sidecar", () => {
  it("projects a receipt into deterministic C2PA-compatible interop metadata without changing verification", () => {
    const key = generateSigningKey("k1");
    const receipt = issueVerifiedReceipt(
      "Dear Jane Roe, return $2,000.00.",
      source,
      { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
      "2026-06-08T12:00:00.000Z",
      {
        signerDomain: "publisher.example",
        contentClass: "tenant-notice",
      },
    );
    const receiptHash = receiptStatusHash(receipt);

    const sidecar = createC2paInteropSidecar(receipt, {
      assetFormat: "text/plain",
      receiptReference: "https://publisher.example/receipts/notice.json",
    });

    expect(C2PA_INTEROP_TARGET.specVersion).toBe("2.4");
    expect(C2PA_INTEROP_TARGET.url).toContain("/2.4/");
    expect(sidecar.interopOnly).toBe(true);
    expect(sidecar.warning).toContain("not an official C2PA manifest store");
    expect(sidecar.groundlock).toEqual({
      exactContentHash: receipt.candidateHash,
      hashCanonicalization: "groundlock:text:nfc-v1",
      receiptHash,
      signerDomain: "publisher.example",
      signerKeyId: "k1",
      contentClass: "tenant-notice",
      receiptReference: "https://publisher.example/receipts/notice.json",
    });
    expect(sidecar.c2paManifestProjection).toEqual({
      instanceID: `xmp:iid:groundlock:${receiptHash.slice("sha256:".length)}`,
      claim_generator: "GroundLock Receipts",
      claim_generator_info: {
        name: "GroundLock Receipts",
        version: sidecar.c2paManifestProjection.claim_generator_info.version,
      },
      "dc:format": "text/plain",
      alg: "sha256",
      created_assertions: [
        {
          url: "self#jumbf=/c2pa/assertions/com.groundlock.receipt.v1",
          alg: "sha256",
          hash: digestJson(sidecar.assertionStore["com.groundlock.receipt.v1"]),
        },
      ],
    });
    expect(sidecar.assertionStore["com.groundlock.receipt.v1"]).toEqual({
      label: "com.groundlock.receipt.v1",
      data: {
        exactContentHash: receipt.candidateHash,
        hashCanonicalization: "groundlock:text:nfc-v1",
        groundlockReceiptHash: receiptHash,
        signer: { domain: "publisher.example", keyId: "k1" },
        contentClass: "tenant-notice",
        receipt: {
          reference: "https://publisher.example/receipts/notice.json",
          hash: receiptHash,
          mediaType: "application/vnd.groundlock.receipt+json",
        },
      },
    });
    expect(createC2paInteropSidecar(receipt, {
      assetFormat: "text/plain",
      receiptReference: "https://publisher.example/receipts/notice.json",
    })).toEqual(sidecar);
    expect(verifyReceipt(receipt, key.publicKeyJwk)).toEqual({ ok: true });
  });
});
