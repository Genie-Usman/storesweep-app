const DEFAULT_RULES = Object.freeze({
  scan: { limit: 10, windowMs: 60_000 },
  clean: { limit: 5, windowMs: 60_000 },
  restore: { limit: 5, windowMs: 60_000 },
});

/**
 * In-memory fixed-window limiter keyed by `${action}:${shop}`.
 * Per-instance by design; safe for cleaning because Shopify file writes
 * are the real serialization point. Swap for Redis when running many
 * instances (see docs/ARCHITECTURE.md).
 */
export function createRateLimiter({ rules = DEFAULT_RULES, now = Date.now } = {}) {
  const buckets = new Map();

  function take(action, shop) {
    const rule = rules[action];
    if (!rule) return { allowed: true };

    const bucketKey = `${action}:${shop}`;
    const windowStart = now();
    const current = buckets.get(bucketKey);

    if (!current || windowStart - current.windowStart >= rule.windowMs) {
      buckets.set(bucketKey, { windowStart, count: 1 });
      return { allowed: true, remaining: rule.limit - 1 };
    }

    current.count += 1;
    if (current.count > rule.limit) {
      const retryAfterSeconds = Math.ceil(
        (current.windowStart + rule.windowMs - windowStart) / 1000,
      );
      return { allowed: false, retryAfterSeconds };
    }

    return { allowed: true, remaining: rule.limit - current.count };
  }

  return { take };
}

export const rateLimiter = createRateLimiter();
export const RATE_LIMIT_RULES = DEFAULT_RULES;
