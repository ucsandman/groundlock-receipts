import { digestText } from "@groundlock/core";
import {
  MAX_VERIFY_BYTES,
  WHAT_IT_DOES_NOT_PROVE,
  WHAT_IT_PROVES,
  summarizeReceipt,
  verifyPublicContentHash,
} from "../../../lib/public-verifier";
import { checkPublicVerifierRateLimit } from "../../../lib/rate-limit";
import { jsonNoStore } from "../../../lib/http";

export const runtime = "nodejs";
const MAX_REQUEST_BYTES = MAX_VERIFY_BYTES + 16 * 1024;

interface VerifyRequestBody {
  candidate?: unknown;
  sourceOfTruth?: unknown;
  fileText?: unknown;
  hash?: unknown;
  url?: unknown;
  remoteUrl?: unknown;
}

const HASH_RE = /^sha256:[A-Za-z0-9_-]{8,}$/;

export async function POST(req: Request) {
  const limited = rateLimit(req);
  if (limited) return limited;

  if (!isJsonContentType(req.headers.get("content-type"))) {
    return publicError("unsupported_content_type", 415);
  }

  const parsed = await readJsonBodyCapped(req);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body;

  if (body.url !== undefined || body.remoteUrl !== undefined) {
    return publicError("remote_url_not_allowed", 400);
  }

  const publicInputs = [body.fileText !== undefined, body.hash !== undefined].filter(Boolean).length;
  if (publicInputs > 1) {
    return publicError("ambiguous_input", 400);
  }
  if (publicInputs === 1) {
    return publicVerify(body);
  }

  if (body.candidate !== undefined || body.sourceOfTruth !== undefined) {
    return publicError("public_signing_not_supported", 403);
  }

  return publicError("missing_public_input", 400);
}

async function readJsonBodyCapped(req: Request): Promise<{ ok: true; body: VerifyRequestBody } | { ok: false; response: Response }> {
  const reader = req.body?.getReader();
  if (!reader) return { ok: false, response: publicError("invalid_json", 400) };

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      return { ok: false, response: publicError("payload_too_large", 413) };
    }
    chunks.push(value);
  }

  try {
    const text = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(text) as unknown;
    if (!isRecord(body)) {
      return { ok: false, response: publicError("invalid_input", 400) };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, response: publicError("invalid_json", 400) };
  }
}

async function publicVerify(body: VerifyRequestBody) {
  const started = performance.now();
  let contentHash: string;
  if (typeof body.fileText === "string") {
    const size = Buffer.byteLength(body.fileText, "utf8");
    if (size > MAX_VERIFY_BYTES) return publicError("payload_too_large", 413);
    contentHash = digestText(body.fileText);
  } else if (typeof body.hash === "string" && HASH_RE.test(body.hash)) {
    contentHash = body.hash;
  } else {
    return publicError("invalid_input", 400);
  }

  const result = await verifyPublicContentHash(contentHash);
  const timingMs = Math.max(0, Math.round(performance.now() - started));
  return jsonNoStore({
    state: result.state,
    code: result.code,
    explanation: result.explanation,
    whatItProves: WHAT_IT_PROVES,
    whatItDoesNotProve: WHAT_IT_DOES_NOT_PROVE,
    receiptSummary: summarizeReceipt(result.receipt),
    timingMs,
  });
}

function publicError(code: string, status: number) {
  return publicErrorWithHeaders(code, status);
}

function publicErrorWithHeaders(code: string, status: number, headers?: HeadersInit) {
  return jsonNoStore(
    {
      state: "UNVERIFIABLE",
      code,
      explanation: "The verification request could not be evaluated.",
      whatItProves: WHAT_IT_PROVES,
      whatItDoesNotProve: WHAT_IT_DOES_NOT_PROVE,
      receiptSummary: null,
      timingMs: 0,
    },
    { status, headers },
  );
}

function rateLimit(_req: Request) {
  const decision = checkPublicVerifierRateLimit();
  if (decision.limited) {
    return publicErrorWithHeaders("rate_limited", 429, {
      "Retry-After": String(decision.retryAfterSeconds ?? 1),
    });
  }
  return null;
}

function isJsonContentType(value: string | null): boolean {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isRecord(value: unknown): value is VerifyRequestBody {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
