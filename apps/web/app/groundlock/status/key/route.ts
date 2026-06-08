import { publicStatusResponse } from "../../../../lib/status-endpoint";

export const runtime = "nodejs";

export function GET(req: Request) {
  return publicStatusResponse(req, "key");
}
