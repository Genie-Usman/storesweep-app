import { authenticate } from "../shopify.server";
import db from "../db.server";
import { recordAudit } from "../services/audit.server";

// StoreSweep stores no customer-level personal data, so a customers/redact
// call needs no deletion; it is acknowledged and audited.
export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  await recordAudit(db, {
    shop,
    action: "gdpr.customers_redact",
    detail: { topic },
  });

  return new Response();
};
