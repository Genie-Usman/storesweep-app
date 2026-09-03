import test from "node:test";
import assert from "node:assert/strict";

import { graphqlWithRetry } from "./theme-api.server.js";

function payload(body, status = 200) {
  return { status, json: async () => body };
}

function throttledAdmin({ failures, status = 200 }) {
  let calls = 0;
  const waits = [];
  return {
    get callCount() {
      return calls;
    },
    waits,
    graphql: async () => {
      calls += 1;
      if (calls <= failures) {
        return payload(
          {
            errors: [
              {
                message: "Throttled",
                extensions: { code: "THROTTLED" },
              },
            ],
          },
          status,
        );
      }
      return payload({ data: { ok: true } });
    },
  };
}

test("retries throttled responses until they succeed", async () => {
  const admin = throttledAdmin({ failures: 2 });
  const waits = [];
  const wait = async (ms) => waits.push(ms);

  const result = await graphqlWithRetry(admin, "query { x }", undefined, {
    wait,
  });

  assert.deepEqual(result, { data: { ok: true } });
  assert.equal(admin.callCount, 3);
  assert.deepEqual(waits, [500, 1000]);
});

test("gives up after the attempt limit", async () => {
  const admin = throttledAdmin({ failures: 99 });
  const wait = async () => {};

  const result = await graphqlWithRetry(admin, "query { x }", undefined, {
    maxAttempts: 3,
    wait,
  });

  assert.match(result.errors[0].message, /Throttled/);
  assert.equal(admin.callCount, 3);
});

test("does not retry non-throttled errors", async () => {
  let calls = 0;
  const admin = {
    graphql: async () => {
      calls += 1;
      return payload({
        errors: [{ message: "Broken", extensions: { code: "SYNTAX" } }],
      });
    },
  };

  await graphqlWithRetry(admin, "query { x }", undefined, { wait: async () => {} });
  assert.equal(calls, 1);
});

test("does not retry successful responses", async () => {
  let calls = 0;
  const admin = {
    graphql: async () => {
      calls += 1;
      return payload({ data: { ok: true } });
    },
  };

  await graphqlWithRetry(admin, "query { x }", undefined, { wait: async () => {} });
  assert.equal(calls, 1);
});
