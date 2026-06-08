export const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
export const MAX_FETCH_TIMEOUT_MS = 30_000;

export function configuredFetchTimeoutMs(value = process.env.GROUNDLOCK_FETCH_TIMEOUT_MS): number | null {
  const raw = value?.trim();
  if (!raw) return DEFAULT_FETCH_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_FETCH_TIMEOUT_MS) {
    return null;
  }
  return parsed;
}

