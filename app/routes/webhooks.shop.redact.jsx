import { authenticate } from "../shopify.server";
import db from "../db.server";
import { logger } from "../utils/logger.server";

// Arrives 30 days after app uninstall. Delete every record we keep for the
// shop. Scan findings cascade from Scan; the other records are removed in
// dependency order before the Shop row itself.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  await db.$transaction([
    db.auditEvent.deleteMany({ where: { shop } }),
    db.cleanOperation.deleteMany({ where: { shop } }),
    db.scan.deleteMany({ where: { shop } }),
    db.shop.delete({ where: { shop } }).catch(() => null),
  ]);

  // The shop's records are gone, so there is nothing left to audit; the
  // structured log is the only trace of this event.
  logger.info("shop data redacted", { shop, topic });

  return new Response();
};
