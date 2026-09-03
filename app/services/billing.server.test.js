import test from "node:test";
import assert from "node:assert/strict";

import {
  getSubscriptionStatus,
  isBillingEnabled,
  isTestBilling,
  PRO_PLAN,
} from "./billing.server.js";

function withEnv(overrides, run) {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve(run()).finally(() => {
    for (const key of Object.keys(overrides)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

test("billing is disabled unless explicitly enabled", () => {
  return withEnv({ BILLING_ENABLED: undefined }, async () => {
    assert.equal(isBillingEnabled(), false);
    assert.equal(isTestBilling(), true);

    const status = await getSubscriptionStatus({});
    assert.deepEqual(status, { enabled: false, subscribed: true });
  });
});

test("reports subscribed when Shopify confirms an active payment", () => {
  return withEnv({ BILLING_ENABLED: "true", NODE_ENV: "test" }, async () => {
    const billing = {
      check: async ({ plans, isTest, returnObject }) => {
        assert.deepEqual(plans, [PRO_PLAN]);
        assert.equal(isTest, true);
        assert.equal(returnObject, true);
        return { hasActivePayment: true };
      },
    };

    const status = await getSubscriptionStatus(billing);
    assert.deepEqual(status, { enabled: true, subscribed: true });
  });
});

test("fails closed when the billing check errors", () => {
  return withEnv({ BILLING_ENABLED: "true", NODE_ENV: "test" }, async () => {
    const billing = {
      check: async () => {
        throw new Error("shopify down");
      },
    };

    const status = await getSubscriptionStatus(billing);
    assert.deepEqual(status, { enabled: true, subscribed: false });
  });
});
