import { authenticate } from "../shopify.server";
import db from "../db.server";
import { runRestore, RestoreError } from "../services/restore-run.server";
import {
  getSubscriptionStatus,
  isBillingEnabled,
} from "../services/billing.server";
import {
  enforceRateLimit,
  errorResponse,
  jsonResponse,
  readJsonBody,
} from "../utils/api-helpers.server";
import {
  isThemeWriteAccessError,
  THEME_WRITE_EXEMPTION_URL,
} from "../utils/theme-write-access";
import { logger } from "../utils/logger.server";

export const action = async ({ request }) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const shop = session.shop;

  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405);
  }

  const limited = enforceRateLimit("restore", shop);
  if (limited) return limited;

  const subscription = await getSubscriptionStatus(billing);
  if (isBillingEnabled() && !subscription.subscribed) {
    return errorResponse(
      "A StoreSweep Pro subscription is required to restore theme files.",
      402,
      { code: "UPGRADE_REQUIRED", billingUrl: "/app/billing" },
    );
  }

  const parsed = await readJsonBody(request);
  if (parsed.error) return errorResponse(parsed.error);

  const { cleanOperationId } = parsed.body;
  if (typeof cleanOperationId !== "string" || !cleanOperationId) {
    return errorResponse("A cleaning operation id is required.");
  }

  try {
    const result = await runRestore({ admin, db, shop, cleanOperationId });
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    if (error instanceof RestoreError) {
      return errorResponse(error.message, 409, { code: "RESTORE_BLOCKED" });
    }

    if (isThemeWriteAccessError(error)) {
      return errorResponse(
        "Shopify must approve StoreSweep for protected theme-file access before restoring can be used.",
        403,
        {
          code: "THEME_WRITE_ACCESS_REQUIRED",
          helpUrl: THEME_WRITE_EXEMPTION_URL,
        },
      );
    }

    logger.error("theme restore failed", {
      shop,
      cleanOperationId,
      error,
    });

    return errorResponse(
      error instanceof Error
        ? error.message
        : "StoreSweep could not restore the backup.",
      500,
    );
  }
};
