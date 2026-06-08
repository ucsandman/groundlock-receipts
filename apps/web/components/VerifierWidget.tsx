"use client";

import { useState, type DragEvent } from "react";
import { cleanCandidate, fabricatingCandidate } from "../lib/examples";

const CLIENT_MAX_BYTES = 256 * 1024;
const revokedCandidate =
  "Dear Jane Roe, your account AC-40192 shows a balance of $1,500.00. Revoked demo copy.";
const unknownHash = "sha256:unknownhashvalue";

type VerifyState = "idle" | "loading" | "PASS" | "BLOCK" | "UNVERIFIABLE" | "REVOKED" | "error";

interface PublicVerifyResponse {
  state: "PASS" | "BLOCK" | "UNVERIFIABLE" | "REVOKED";
  code: string;
  explanation: string;
  whatItProves: string;
  whatItDoesNotProve: string;
  receiptSummary: null | {
    signerDomain: string;
    signerKeyId: string;
    contentClass: string;
    issuedAt: string;
    verdict: "pass" | "block";
    contentHash: string;
    receiptHash: string;
  };
  timingMs: number;
}

interface Message {
  state: VerifyState;
  title: string;
  body: string;
  response?: PublicVerifyResponse;
}

interface VerifierWidgetProps {
  className?: string;
}

const stateTone: Record<string, string> = {
  PASS: "border-emerald-600 bg-emerald-50 text-emerald-950",
  BLOCK: "border-[var(--danger)] bg-red-50 text-red-950",
  UNVERIFIABLE: "border-amber-600 bg-amber-50 text-amber-950",
  REVOKED: "border-slate-900 bg-slate-100 text-slate-950",
  error: "border-[var(--danger)] bg-red-50 text-red-950",
  idle: "border-[var(--line)] bg-[var(--paper)] text-[var(--ink)]",
  loading: "border-blue-700 bg-blue-50 text-blue-950",
};

const sampleButtonClass =
  "min-h-11 border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm font-bold transition hover:-translate-y-0.5 hover:bg-[var(--acid)] disabled:translate-y-0 disabled:opacity-60";

export function VerifierWidget({ className = "" }: VerifierWidgetProps) {
  const [hash, setHash] = useState("");
  const [message, setMessage] = useState<Message>({
    state: "idle",
    title: "Ready",
    body: "Paste a GroundLock hash, choose text content, or run a live sample.",
  });
  const [dragging, setDragging] = useState(false);
  const busy = message.state === "loading";

  async function verifyBody(body: unknown) {
    setMessage({ state: "loading", title: "Checking", body: "Reconstructing DNS cache chunks, receipt, signature, and status." });
    const started = performance.now();
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as PublicVerifyResponse;
      if (!res.ok && json.code === "invalid_input") {
        setMessage({ state: "error", title: "Invalid input", body: "Paste a GroundLock sha256: hash or choose a file." });
        return;
      }
      if (!res.ok && json.code === "payload_too_large") {
        setMessage({ state: "error", title: "File too large", body: "Maximum verifier input is 256 KiB." });
        return;
      }
      if (!res.ok && json.code === "rate_limited") {
        setMessage({ state: "error", title: "Slow down", body: "Too many checks from this network. Try again shortly." });
        return;
      }
      setMessage({
        state: json.state,
        title: json.state,
        body: `${json.explanation} (${Math.round(performance.now() - started)} ms client round trip).`,
        response: json,
      });
    } catch {
      setMessage({ state: "error", title: "Network failure", body: "The verifier could not reach the server." });
    }
  }

  async function verifyHash() {
    const value = hash.trim();
    if (!value) {
      setMessage({ state: "idle", title: "Empty hash", body: "Paste a GroundLock sha256: hash before verifying." });
      return;
    }
    await verifyBody({ hash: value });
  }

  async function verifyFile(file: File) {
    if (file.size > CLIENT_MAX_BYTES) {
      setMessage({ state: "error", title: "File too large", body: "Maximum verifier input is 256 KiB." });
      return;
    }
    await verifyBody({ fileText: await file.text() });
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void verifyFile(file);
  }

  return (
    <section
      aria-label="Public receipt verifier"
      className={`border border-[var(--line)] bg-[var(--paper)] shadow-[8px_8px_0_var(--ink)] ${className}`}
      id="verify"
    >
      <div className="flex flex-col gap-3 border-b border-[var(--line)] bg-[var(--acid)] px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-bold uppercase text-[color-mix(in_oklch,var(--ink)_74%,transparent)]">
            Live public verifier
          </p>
          <h2 className="font-[family-name:var(--font-display)] text-3xl font-semibold">Try the receipt path</h2>
        </div>
        <p className="max-w-xs text-sm font-bold">Free, accountless, hash-only verify.</p>
      </div>

      <div className="grid gap-px bg-[var(--line)] md:grid-cols-2">
        <div
          data-verifier-dropzone
          className={`bg-[var(--paper)] p-4 transition ${
            dragging ? "outline outline-4 outline-[var(--acid)]" : ""
          }`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <h3 className="text-lg font-bold">File</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted-ink)]">Drop or select local content.</p>
          <input
            className="mt-4 block w-full text-sm text-[var(--muted-ink)] file:mr-4 file:border-0 file:bg-[var(--ink)] file:px-4 file:py-2 file:text-sm file:font-bold file:text-[var(--paper)]"
            disabled={busy}
            type="file"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void verifyFile(file);
            }}
          />
        </div>

        <div className="bg-[var(--paper)] p-4">
          <h3 className="text-lg font-bold">Hash</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--muted-ink)]">Paste the GroundLock content hash.</p>
          <label className="mt-4 block">
            <span className="sr-only">GroundLock sha256 hash</span>
            <input
              className="h-11 w-full border border-[var(--line)] bg-white px-3 font-mono text-sm outline-none focus:ring-4 focus:ring-[var(--acid)]"
              value={hash}
              placeholder="sha256:..."
              onChange={(event) => setHash(event.target.value)}
            />
          </label>
          <button
            className="mt-3 h-11 w-full border border-[var(--line)] bg-[var(--ink)] px-4 text-sm font-bold text-[var(--paper)] transition hover:bg-[var(--brass)] disabled:opacity-60"
            disabled={busy}
            onClick={() => void verifyHash()}
          >
            Verify Hash
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-[var(--line)] bg-[var(--surface)] p-4">
        <button className={sampleButtonClass} disabled={busy} onClick={() => void verifyBody({ fileText: cleanCandidate })}>
          PASS sample
        </button>
        <button className={sampleButtonClass} disabled={busy} onClick={() => void verifyBody({ fileText: fabricatingCandidate })}>
          BLOCK sample
        </button>
        <button className={sampleButtonClass} disabled={busy} onClick={() => void verifyBody({ fileText: revokedCandidate })}>
          REVOKED sample
        </button>
        <button className={sampleButtonClass} disabled={busy} onClick={() => void verifyBody({ hash: unknownHash })}>
          Unknown hash
        </button>
      </div>

      <ResultPanel message={message} />
    </section>
  );
}

function ResultPanel({ message }: { message: Message }) {
  const tone = stateTone[message.state] ?? stateTone.idle;
  return (
    <section className={`border-t-4 p-4 ${tone}`} aria-live="polite" aria-busy={message.state === "loading"}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-bold uppercase">{message.state}</p>
          <h3 className="mt-1 text-2xl font-bold">{message.title}</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6">{message.body}</p>
        </div>
        {message.response ? (
          <div className="shrink-0 text-left text-sm md:text-right">
            <p className="font-mono">{message.response.code}</p>
            <p>{message.response.timingMs} ms server timing</p>
          </div>
        ) : null}
      </div>

      {message.response?.receiptSummary ? (
        <dl className="mt-5 grid gap-3 text-sm md:grid-cols-3">
          <div>
            <dt className="font-bold">Signer</dt>
            <dd className="break-words">{message.response.receiptSummary.signerDomain}</dd>
          </div>
          <div>
            <dt className="font-bold">Verdict</dt>
            <dd>{message.response.receiptSummary.verdict}</dd>
          </div>
          <div>
            <dt className="font-bold">Receipt</dt>
            <dd className="break-all font-mono text-xs">{message.response.receiptSummary.receiptHash}</dd>
          </div>
        </dl>
      ) : null}

      {message.response ? (
        <div className="mt-5 grid gap-3 text-sm md:grid-cols-2">
          <p>
            <span className="font-bold">What it proves: </span>
            {message.response.whatItProves}
          </p>
          <p>
            <span className="font-bold">What it does not prove: </span>
            {message.response.whatItDoesNotProve}
          </p>
        </div>
      ) : null}
    </section>
  );
}
