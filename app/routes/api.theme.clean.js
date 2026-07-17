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

const checksum = (content) =>
  createHash("sha256").update(content, "utf8").digest("hex");

const badRequest = (error, status = 400) =>
  Response.json(
    { success: false, error },
    { status, headers: { "Cache-Control": "private, no-store" } },
  );

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return badRequest("Method not allowed.", 405);
  }

  let submitted;
  try {
    submitted = await request.json();
  } catch {
    return badRequest("The request body must be valid JSON.");
  }

  const { modifiedThemeCode, selectedFindingIds, themeChecksum } = submitted;
  if (
    typeof modifiedThemeCode !== "string" ||
    !Array.isArray(selectedFindingIds) ||
    selectedFindingIds.length === 0 ||
    !selectedFindingIds.every((id) => typeof id === "string") ||
    typeof themeChecksum !== "string"
  ) {
    return badRequest("Modified theme code and selected findings are required.");
  }

  try {
    const themeId = await getMainThemeId(admin);
    const currentThemeCode = await getThemeLiquid(admin, themeId);

    if (checksum(currentThemeCode) !== themeChecksum) {
      return badRequest(
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
      return badRequest(
        "One or more selected findings are no longer present. Scan again.",
        409,
      );
    }

    const verifiedThemeCode = removeFindings(
      currentThemeCode,
      selectedFindings,
    );
    if (verifiedThemeCode !== modifiedThemeCode) {
      return badRequest(
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
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Theme clean failed.",
      },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
};
