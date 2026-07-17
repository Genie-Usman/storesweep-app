import { createHash } from "node:crypto";

import { authenticate } from "../shopify.server";
import { waitForShopifyJob } from "../services/shopify-job.server";
import {
  backupThemeLiquid,
  getMainThemeId,
  getThemeLiquid,
  updateThemeLiquid,
} from "../services/theme-api.server";
import { identifyFindings, removeFindings } from "../utils/findings";
import { scanThemeLiquid } from "../utils/scanner";
import {
  isThemeWriteAccessError,
  THEME_WRITE_EXEMPTION_URL,
} from "../utils/theme-write-access";

const checksum = (content) =>
  createHash("sha256").update(content, "utf8").digest("hex");

const errorResponse = (error, status = 400, extra = {}) =>
  Response.json(
    { success: false, error, ...extra },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405);
  }

  let submitted;
  try {
    submitted = await request.json();
  } catch {
    return errorResponse("The request body must be valid JSON.");
  }

  const { modifiedThemeCode, selectedFindingIds, themeChecksum } = submitted;
  if (
    typeof modifiedThemeCode !== "string" ||
    !Array.isArray(selectedFindingIds) ||
    selectedFindingIds.length === 0 ||
    !selectedFindingIds.every((id) => typeof id === "string") ||
    typeof themeChecksum !== "string"
  ) {
    return errorResponse(
      "Modified theme code and selected findings are required.",
    );
  }

  try {
    const themeId = await getMainThemeId(admin);
    const currentThemeCode = await getThemeLiquid(admin, themeId);

    if (checksum(currentThemeCode) !== themeChecksum) {
      return errorResponse(
        "The live theme changed after this scan. Scan again before cleaning.",
        409,
      );
    }

    const currentFindings = identifyFindings(scanThemeLiquid(currentThemeCode));
    const findingsById = new Map(
      currentFindings.map((finding) => [finding.id, finding]),
    );
    const uniqueSelectedIds = [...new Set(selectedFindingIds)];
    const selectedFindings = uniqueSelectedIds.map((id) => findingsById.get(id));

    if (selectedFindings.some((finding) => !finding)) {
      return errorResponse(
        "One or more selected findings are no longer present. Scan again.",
        409,
      );
    }

    const verifiedThemeCode = removeFindings(
      currentThemeCode,
      selectedFindings,
    );
    if (verifiedThemeCode !== modifiedThemeCode) {
      return errorResponse(
        "The submitted theme code contains changes outside the selected findings.",
      );
    }

    const backup = await backupThemeLiquid(admin, themeId, currentThemeCode);
    await waitForShopifyJob(admin, backup.jobId);

    const update = await updateThemeLiquid(admin, themeId, verifiedThemeCode);
    await waitForShopifyJob(admin, update.jobId);

    return Response.json(
      {
        success: true,
        cleanedCount: uniqueSelectedIds.length,
        backupFilename: backup.filename,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("StoreSweep theme clean failed", error);

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

    return errorResponse(
      error instanceof Error ? error.message : "Theme clean failed.",
      500,
    );
  }
};
