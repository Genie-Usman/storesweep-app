import { authenticate } from "../shopify.server";
import db from "../db.server";
import { runClean, ThemeChangedError } from "../services/clean-run.server";
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
    return errorResponse("Method not allowed.");
  }

  const limited = enforceRateLimit("clean", shop);
  if (limited) return limited;

  const subscription = await getSubscriptionStatus(billing);
  if (isBillingEnabled() && !subscription.subscribed) {
    return errorResponse(
      "A StoreSweep Pro subscription is required to clean theme files. Scanning remains free.",
      402,
      { code: "UPGRADE_REQUIRED", billingUrl: "/app/billing" },
    );
  }

  const parsed = await readJsonBody(request);
  if (parsed.error) return errorResponse(parsed.error);

  const { selectedFindingIds, fileChecksums, scanId, themeId } = parsed.body;

  if (
    !Array.isArray(selectedFindingIds) ||
    selectedFindingIds.length === 0 ||
    !selectedFindingIds.every((id) => typeof id === "string")
  ) {
    return errorResponse("Selected findings are required.");
  }

  if (
    themeId !== undefined &&
    themeId !== null &&
    typeof themeId !== "string"
  ) {
    return errorResponse("themeId must be a string when provided.");
  }

  if (
    fileChecksums !== undefined &&
    (typeof fileChecksums !== "object" ||
      fileChecksums === null ||
      Object.values(fileChecksums).some((value) => typeof value !== "string"))
  ) {
    return errorResponse("File checksums must be a map of filename to checksum.");
  }

  try {
    const result = await runClean({
      admin,
      db,
      shop,
      themeId: typeof themeId === "string" ? themeId : null,
      scanId: typeof scanId === "string" ? scanId : null,
      selectedFindingIds,
      fileChecksums: fileChecksums ?? {},
    });

    return jsonResponse({ success: true, ...result });
  } catch (error) {
    if (error instanceof ThemeChangedError) {
      return errorResponse(error.message, { code: "THEME_CHANGED" });
    }

    if (isThemeWriteAccessError(error)) {
      return errorResponse(
        "Shopify must approve StoreSweep for protected theme-file access before automatic cleaning can be used. Scanning remains available.",
        403,
        {
          code: "THEME_WRITE_ACCESS_REQUIRED",
          helpUrl: THEME_WRITE_EXEMPTION_URL,
        },
      );
    }

    logger.error("theme clean failed", {
      shop,
      error,
    });

    return errorResponse(
      error instanceof Error
        ? error.message
        : "StoreSweep could not clean the selected code.",
      500,
    );
  }
};
