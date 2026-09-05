import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getScanJob, startScanJob } from "../services/scan-jobs.server";
import { enforceRateLimit, errorResponse, jsonResponse, readJsonBody } from "../utils/api-helpers.server";

/**
 * GET: poll the status of this shop's background scan for a theme.
 * POST: start a background scan (deduped while one is already running).
 */
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const themeId = url.searchParams.get("themeId");

  const job = getScanJob(shop, themeId);
  if (!job) {
    return jsonResponse({ success: true, status: "idle" });
  }

  return jsonResponse({ success: true, ...job });
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  if (request.method !== "POST") {
    return errorResponse("Method not allowed.");
  }

  const limited = enforceRateLimit("scan", shop);
  if (limited) return limited;

  const parsed = await readJsonBody(request);
  if (parsed.error) return errorResponse(parsed.error);

  const { themeId } = parsed.body;
  if (themeId !== undefined && themeId !== null && typeof themeId !== "string") {
    return errorResponse("themeId must be a string when provided.");
  }

  const { job, deduped } = startScanJob({ admin, db, shop, themeId });

  return jsonResponse({ success: true, deduped, ...job });
};
