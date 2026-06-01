import { NextResponse } from "next/server";
import { getSigningKey } from "@/lib/signing";

export const runtime = "nodejs";

export function GET() {
  const { kid, publicKeyJwk } = getSigningKey();
  return NextResponse.json({ kid, publicKeyJwk });
}
