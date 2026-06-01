"use client";

import { useState } from "react";
import { canonicalizeJson, type ProofReceipt } from "@groundlock/core";
import { exampleSource, cleanCandidate, fabricatingCandidate } from "@/lib/examples";

interface VerifyResponse {
  result: { verdict: "pass" | "block"; violations: { code: string; label: string; detail?: string }[] };
  receipt: ProofReceipt;
  publicKeyJwk: JsonWebKey;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function reverifyReceipt(receipt: ProofReceipt, publicKeyJwk: JsonWebKey): Promise<boolean> {
  try {
    const { signature, ...base } = receipt;
    const key = await crypto.subtle.importKey("jwk", publicKeyJwk, { name: "Ed25519" }, false, ["verify"]);
    const data = new TextEncoder().encode(canonicalizeJson(base));
    return await crypto.subtle.verify({ name: "Ed25519" }, key, b64urlToBytes(signature.sig), data);
  } catch {
    return false; // fail-closed
  }
}

export default function Home() {
  const [candidate, setCandidate] = useState(cleanCandidate);
  const [sourceText, setSourceText] = useState(JSON.stringify(exampleSource, null, 2));
  const [resp, setResp] = useState<VerifyResponse | null>(null);
  const [reverified, setReverified] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onVerify() {
    setError(null);
    setReverified(null);
    setResp(null);
    let sourceOfTruth: unknown;
    try {
      sourceOfTruth = JSON.parse(sourceText);
    } catch {
      setError("Source of truth is not valid JSON.");
      return;
    }
    const r = await fetch("/api/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ candidate, sourceOfTruth }),
    });
    if (!r.ok) {
      setError("Verify request failed.");
      return;
    }
    const data = (await r.json()) as VerifyResponse;
    setResp(data);
    setReverified(await reverifyReceipt(data.receipt, data.publicKeyJwk));
  }

  const verdict = resp?.result.verdict;

  return (
    <main className="mx-auto max-w-4xl p-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">GroundLock</h1>
        <p className="text-neutral-600">
          The AI cannot send a fabricated number, date, or registered identifier. Verify a draft against a source of
          truth and get a signed, re-verifiable proof.
        </p>
      </header>

      <div className="flex gap-2">
        <button className="rounded bg-neutral-200 px-3 py-1 text-sm" onClick={() => setCandidate(cleanCandidate)}>
          Load clean example
        </button>
        <button className="rounded bg-neutral-200 px-3 py-1 text-sm" onClick={() => setCandidate(fabricatingCandidate)}>
          Load fabricating example
        </button>
      </div>

      <label className="block">
        <span className="text-sm font-medium">AI-drafted message</span>
        <textarea
          className="mt-1 h-32 w-full rounded border p-2 font-mono text-sm"
          value={candidate}
          onChange={(e) => setCandidate(e.target.value)}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Source of truth (JSON)</span>
        <textarea
          className="mt-1 h-56 w-full rounded border p-2 font-mono text-xs"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
        />
      </label>

      <button className="rounded bg-neutral-900 px-4 py-2 font-medium text-white" onClick={onVerify}>
        Verify
      </button>

      {error && <p className="text-red-600">{error}</p>}

      {resp && (
        <section className="space-y-4">
          <div
            className={
              "rounded p-3 font-semibold " +
              (verdict === "pass" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")
            }
          >
            {verdict === "pass" ? "PASS - every fact traced to the source of truth" : "BLOCK - fabricated or missing facts"}
          </div>

          {resp.result.violations.length > 0 && (
            <ul className="list-disc space-y-1 pl-6 text-sm">
              {resp.result.violations.map((v, i) => (
                <li key={i}>
                  <span className="font-mono">{v.code}</span> [{v.label}]
                  {v.detail ? <span className="text-neutral-600"> - {v.detail}</span> : null}
                </li>
              ))}
            </ul>
          )}

          <div className="rounded border p-3 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">Signed proof receipt</span>
              <span className={reverified ? "text-green-700" : "text-red-700"}>
                {reverified === null ? "" : reverified ? "signature re-verified in your browser" : "signature INVALID"}
              </span>
            </div>
            <pre className="max-h-64 overflow-auto bg-neutral-100 p-2 text-xs">
              {JSON.stringify(resp.receipt, null, 2)}
            </pre>
            <a
              className="mt-2 inline-block text-blue-700 underline"
              href={"data:application/json," + encodeURIComponent(JSON.stringify(resp.receipt, null, 2))}
              download="groundlock-receipt.json"
            >
              Download receipt
            </a>
          </div>

          <p className="text-xs text-neutral-500">
            This receipt proves the message bytes, the verdict, and the source-of-truth version were signed by the issuer
            and have not changed. It does not prove the time of issuance or the semantic correctness of any prose claim.
          </p>
        </section>
      )}
    </main>
  );
}
