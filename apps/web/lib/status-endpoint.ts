import { NextResponse } from "next/server";
import {
  publicClaimStatusLookup,
  publicKeyStatusLookup,
  type StatusRecord,
  type StatusRecordKind,
} from "@groundlock/core";

export function publicStatusResponse(req: Request, kind: StatusRecordKind): NextResponse {
  const lookup = new URL(req.url).searchParams.get("lookup")?.trim();
  if (!lookup) return jsonError("missing_lookup", 400);

  const records = readStatusRecords();
  if (records.type !== "ok") return jsonError(records.code, records.status);

  const record = records.records.find((candidate) => statusRecordLookup(candidate) === lookup && candidate.kind === kind);
  if (!record) return jsonError("status_not_found", 404);
  return NextResponse.json(record);
}

function readStatusRecords():
  | { type: "ok"; records: StatusRecord[] }
  | { type: "error"; code: string; status: number } {
  const raw = process.env.GROUNDLOCK_STATUS_RECORDS_JSON?.trim();
  if (!raw) return { type: "error", code: "status_records_not_configured", status: 503 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { type: "error", code: "status_records_malformed", status: 503 };
  }
  if (!Array.isArray(parsed)) return { type: "error", code: "status_records_malformed", status: 503 };
  return { type: "ok", records: parsed.filter(isStatusRecordShape) };
}

function statusRecordLookup(record: StatusRecord): string {
  if (record.kind === "key") {
    return publicKeyStatusLookup(record.subject.signerDomain, record.subject.kid).lookupKey;
  }
  return publicClaimStatusLookup(record.subject.receiptHash).lookupKey;
}

function isStatusRecordShape(value: unknown): value is StatusRecord {
  if (!isRecord(value) || value.version !== "groundlock-status/v1" || typeof value.kind !== "string") {
    return false;
  }
  if (value.kind === "key") {
    return (
      isRecord(value.subject) &&
      typeof value.subject.signerDomain === "string" &&
      typeof value.subject.kid === "string"
    );
  }
  if (value.kind === "claim") {
    return isRecord(value.subject) && typeof value.subject.receiptHash === "string";
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}
