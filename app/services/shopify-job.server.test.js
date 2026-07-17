import test from "node:test";
import assert from "node:assert/strict";

import { waitForShopifyJob } from "./shopify-job.server.js";

test("returns immediately when no job was created", async () => {
  await waitForShopifyJob(null, null);
});

test("polls until a Shopify job completes", async () => {
  let calls = 0;
  const admin = {
    graphql: async () => ({
      json: async () => ({
        data: { job: { done: (calls += 1) === 2 } },
      }),
    }),
  };
  const waits = [];

  await waitForShopifyJob(admin, "job-id", {
    delayMs: 1,
    wait: async (milliseconds) => waits.push(milliseconds),
  });

  assert.equal(calls, 2);
  assert.deepEqual(waits, [1]);
});

test("throws after the polling limit", async () => {
  const admin = {
    graphql: async () => ({
      json: async () => ({ data: { job: { done: false } } }),
    }),
  };

  await assert.rejects(
    waitForShopifyJob(admin, "job-id", {
      maxAttempts: 2,
      wait: async () => {},
    }),
    /timed out/,
  );
});
