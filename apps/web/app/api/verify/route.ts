import { NextResponse } from "next/server";
import { digestText } from "@groundlock/core";
import {
  MAX_VERIFY_BYTES,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  WHAT_IT_DOES_NOT_PROVE,
  WHAT_IT_PROVES,
  summarizeReceipt,
  verifyPublicContentHash,
} from "../../../lib/public-verifier";

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

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_KEY = "public-verifier";
const HASH_RE = /^sha256:[A-Za-z0-9_-]{8,}$/;

export async function POST(req: Request) {
  const limited = rateLimit(req);
  if (limited) return limited;

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

async function readJsonBodyCapped(req: Request): Promise<{ ok: true; body: VerifyRequestBody } | { ok: false; response: NextResponse }> {
  const reader = req.body?.getReader();
  if (!reader) return { ok: false, response: NextResponse.json({ error: "invalid_json" }, { status: 400 }) };

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
    return { ok: true, body: JSON.parse(text) as VerifyRequestBody };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "invalid_json" }, { status: 400 }) };
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
  return NextResponse.json({
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
  return NextResponse.json(
    {
      state: "UNVERIFIABLE",
      code,
      explanation: "The verification request could not be evaluated.",
      whatItProves: WHAT_IT_PROVES,
      whatItDoesNotProve: WHAT_IT_DOES_NOT_PROVE,
      receiptSummary: null,
      timingMs: 0,
    },
    { status },
  );
}

function rateLimit(_req: Request) {
  const now = Date.now();
  pruneRateBuckets(now);
  const bucket = rateBuckets.get(RATE_LIMIT_KEY);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(RATE_LIMIT_KEY, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return null;
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    return publicError("rate_limited", 429);
  }
  return null;
}

function pruneRateBuckets(now: number) {
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}
