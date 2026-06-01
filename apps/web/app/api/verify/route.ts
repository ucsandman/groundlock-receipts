import { NextResponse } from "next/server";
import { verify, issueReceipt, type SourceOfTruth } from "@groundlock/core";
import { getSigningKey } from "@/lib/signing";

export const runtime = "nodejs";

interface VerifyRequestBody {
  candidate?: unknown;
  sourceOfTruth?: unknown;
}

export async function POST(req: Request) {
  let body: VerifyRequestBody;
  try {
    body = (await req.json()) as VerifyRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.candidate !== "string" || typeof body.sourceOfTruth !== "object" || body.sourceOfTruth === null) {
    return NextResponse.json({ error: "candidate (string) and sourceOfTruth (object) are required" }, { status: 400 });
  }

  const candidate = body.candidate;
  const source = body.sourceOfTruth as SourceOfTruth;
  const key = getSigningKey();

  const result = verify(candidate, source);
  const receipt = issueReceipt(
    result,
    candidate,
    source,
    { kid: key.kid, privateKeyJwk: key.privateKeyJwk },
    new Date().toISOString(),
  );

  return NextResponse.json({ result, receipt, publicKeyJwk: key.publicKeyJwk });
}
