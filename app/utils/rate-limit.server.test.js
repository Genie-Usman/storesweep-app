import test from "node:test";
import assert from "node:assert/strict";

import { createRateLimiter } from "./rate-limit.server.js";

function fakeClock() {
  let current = 1_000_000;
  return {
    now: () => current,
    advance: (milliseconds) => {
      current += milliseconds;
    },
  };
}

test("allows requests under the limit and blocks beyond it", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({
    rules: { scan: { limit: 2, windowMs: 60_000 } },
    now: clock.now,
  });

  assert.equal(limiter.take("scan", "shop-a").allowed, true);
  assert.equal(limiter.take("scan", "shop-a").allowed, true);

  const blocked = limiter.take("scan", "shop-a");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds > 0, true);
});

test("tracks shops independently", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({
    rules: { scan: { limit: 1, windowMs: 60_000 } },
    now: clock.now,
  });

  assert.equal(limiter.take("scan", "shop-a").allowed, true);
  assert.equal(limiter.take("scan", "shop-b").allowed, true);
  assert.equal(limiter.take("scan", "shop-a").allowed, false);
});

test("opens a fresh window after the window elapses", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({
    rules: { clean: { limit: 1, windowMs: 30_000 } },
    now: clock.now,
  });

  assert.equal(limiter.take("clean", "shop-a").allowed, true);
  assert.equal(limiter.take("clean", "shop-a").allowed, false);

  clock.advance(30_001);
  assert.equal(limiter.take("clean", "shop-a").allowed, true);
});

test("isolates actions from each other", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({
    rules: {
      scan: { limit: 1, windowMs: 60_000 },
      clean: { limit: 1, windowMs: 60_000 },
    },
    now: clock.now,
  });

  assert.equal(limiter.take("scan", "shop-a").allowed, true);
  assert.equal(limiter.take("clean", "shop-a").allowed, true);
});

test("ignores unknown actions", () => {
  const clock = fakeClock();
  const limiter = createRateLimiter({ now: clock.now });

  assert.deepEqual(limiter.take("unknown", "shop-a"), { allowed: true });
});
