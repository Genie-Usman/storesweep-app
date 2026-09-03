import { authenticate } from "../shopify.server";
import db from "../db.server";
import { recordAudit } from "../services/audit.server";

// Shopify is legally required to forward customers/data_request to apps.
// StoreSweep stores no customer personal data, only shop-level theme
// records, so the request is acknowledged and audited for the record.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  await recordAudit(db, {
    shop,
    action: "gdpr.customers_data_request",
    detail: { topic },
  });

  return new Response();
};
