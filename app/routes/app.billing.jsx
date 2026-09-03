import { authenticate } from "../shopify.server";
import {
  getSubscriptionStatus,
  isBillingEnabled,
  requestProSubscription,
} from "../services/billing.server";

/**
 * Starts the Shopify subscription flow for the Pro plan and redirects the
 * merchant to Shopify's payment confirmation page. Billing must be enabled
 * (BILLING_ENABLED=true) for this route to do anything.
 */
export const loader = async ({ request }) => {
  const { billing, redirect } = await authenticate.admin(request);

  if (!isBillingEnabled()) {
    return redirect("/app");
  }

  const subscription = await getSubscriptionStatus(billing);
  if (subscription.subscribed) {
    return redirect("/app");
  }

  return requestProSubscription(billing);
};
