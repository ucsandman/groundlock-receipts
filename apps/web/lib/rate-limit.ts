import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./public-verifier";

const RATE_LIMIT_KEY = "public-verifier";
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitDecision {
  limited: boolean;
  retryAfterSeconds?: number;
}

export function checkPublicVerifierRateLimit(now = Date.now()): RateLimitDecision {
  pruneRateBuckets(now);
  const bucket = rateBuckets.get(RATE_LIMIT_KEY);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(RATE_LIMIT_KEY, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { limited: false };
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  return { limited: false };
}

export function resetPublicVerifierRateLimitForTest(): void {
  rateBuckets.clear();
}

function pruneRateBuckets(now: number) {
  for (const [key, bucket] of rateBuckets) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}
