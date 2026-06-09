const RATE_LIMIT_KEY = "public-verifier";
export const RATE_LIMIT_MAX = 240;
export const RATE_LIMIT_WINDOW_MS = 60_000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitDecision {
  limited: boolean;
  invalidConfig?: boolean;
  retryAfterSeconds?: number;
}

export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export function configuredRateLimit(
  maxValue = process.env.GROUNDLOCK_RATE_LIMIT_MAX,
  windowValue = process.env.GROUNDLOCK_RATE_LIMIT_WINDOW_MS,
): RateLimitConfig | null {
  const max = readPositiveSafeIntEnv(maxValue, RATE_LIMIT_MAX);
  const windowMs = readPositiveSafeIntEnv(windowValue, RATE_LIMIT_WINDOW_MS);
  if (max === null || windowMs === null) return null;
  return { max, windowMs };
}

export function checkPublicVerifierRateLimit(now = Date.now()): RateLimitDecision {
  const config = configuredRateLimit();
  if (config === null) return { limited: false, invalidConfig: true };
  pruneRateBuckets(now);
  const bucket = rateBuckets.get(RATE_LIMIT_KEY);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(RATE_LIMIT_KEY, { count: 1, resetAt: now + config.windowMs });
    return { limited: false };
  }

  bucket.count += 1;
  if (bucket.count > config.max) {
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

function readPositiveSafeIntEnv(value: string | undefined, fallback: number): number | null {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}
