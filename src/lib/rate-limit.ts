import { createHash } from "node:crypto";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function hashRateLimitKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function checkRateLimit(rawKey: string, limit = 10, windowMs = 60_000) {
  const key = hashRateLimitKey(rawKey);
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });

    return {
      allowed: true,
      remaining: limit - 1,
      resetAt,
      retryAfterMs: 0,
    };
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: bucket.resetAt,
      retryAfterMs: Math.max(0, bucket.resetAt - now),
    };
  }

  bucket.count += 1;

  return {
    allowed: true,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
    retryAfterMs: 0,
  };
}

export function clearRateLimitState() {
  buckets.clear();
}
