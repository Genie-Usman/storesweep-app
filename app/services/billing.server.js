import { logger } from "../utils/logger.server.js";

export const PRO_PLAN = "Pro";

/** Billing is opt-in so development stores work out of the box. */
export function isBillingEnabled() {
  return process.env.BILLING_ENABLED === "true";
}

/** Use Shopify test subscriptions outside production. */
export function isTestBilling() {
  return process.env.NODE_ENV !== "production";
}

/**
 * Resolve whether the shop can perform paid actions. Fails closed: if the
 * billing check errors, the shop is treated as unsubscribed.
 */
export async function getSubscriptionStatus(billing) {
  if (!isBillingEnabled()) {
    return { enabled: false, subscribed: true };
  }

  try {
    const result = await billing.check({
      plans: [PRO_PLAN],
      isTest: isTestBilling(),
      returnObject: true,
    });
    return { enabled: true, subscribed: result.hasActivePayment };
  } catch (error) {
    logger.warn("billing check failed", { error });
    return { enabled: true, subscribed: false };
  }
}

/** Returns a redirect Response to Shopify's payment confirmation page. */
export async function requestProSubscription(billing) {
  return billing.request({
    plan: PRO_PLAN,
    isTest: isTestBilling(),
    returnObject: true,
  });
}
