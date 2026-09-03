import { authenticate } from "../shopify.server";
import db from "../db.server";
import { markShopUninstalled, recordAudit } from "../services/audit.server";
import { logger } from "../utils/logger.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  logger.info("webhook received", { shop, topic });

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  try {
    await markShopUninstalled(db, shop);
    await recordAudit(db, {
      shop,
      action: "app.uninstalled",
      detail: { topic },
    });
  } catch (error) {
    // The shop row is best-effort bookkeeping; never fail the webhook.
    logger.warn("uninstall bookkeeping failed", { shop, error });
  }

  return new Response();
};
