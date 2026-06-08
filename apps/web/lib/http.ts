import { NextResponse } from "next/server";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export function jsonNoStore(body: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...init?.headers,
    },
  });
}
