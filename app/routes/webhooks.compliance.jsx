import { authenticate } from "../shopify.server";
import db from "../db.server";
import { recordAudit } from "../services/audit.server";
import { logger } from "../utils/logger.server";

// Mandatory privacy-law compliance endpoint, subscribed via
// compliance_topics in shopify.app.toml. All three topics arrive here.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  logger.info("webhook received", { shop, topic });

  switch (topic) {
    // StoreSweep stores no customer-level personal data; acknowledge and
    // audit both customer requests.
    case "customers/data_request":
    case "customers/redact": {
      await recordAudit(db, {
        shop,
        action: `gdpr.${topic.split("/").join("_")}`,
        detail: { topic },
      });
      return new Response();
    }

    // Arrives 30 days after app uninstall. Delete every record we keep for
    // the shop. Scan findings cascade from Scan; the other records are
    // removed in dependency order before the Shop row itself.
    case "shop/redact": {
      await db.$transaction([
        db.auditEvent.deleteMany({ where: { shop } }),
        db.cleanOperation.deleteMany({ where: { shop } }),
        db.scan.deleteMany({ where: { shop } }),
        db.ignoredFinding.deleteMany({ where: { shop } }),
        db.ignoredApp.deleteMany({ where: { shop } }),
        db.shop.delete({ where: { shop } }).catch(() => null),
      ]);

      // The shop's records are gone, so there is nothing left to audit;
      // the structured log is the only trace of this event.
      logger.info("shop data redacted", { shop, topic });

      return new Response();
    }

    default: {
      logger.warn("unexpected compliance topic", { shop, topic });
      return new Response();
    }
  }
};
