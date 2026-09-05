import { authenticate } from "../shopify.server";
import db from "../db.server";
import { touchShop } from "../services/audit.server";
import { logger } from "../utils/logger.server";

// A newly published theme invalidates previous scan results. Record the
// publish time so the dashboard can flag scans taken before it.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  logger.info("webhook received", { shop, topic });

  try {
    await touchShop(db, shop, { lastThemePublishAt: new Date() });
  } catch (error) {
    logger.warn("theme publish bookkeeping failed", { shop, error });
  }

  return new Response();
};
