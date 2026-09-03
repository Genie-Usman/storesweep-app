import { authenticate } from "../shopify.server";
import db from "../db.server";
import { runScan } from "../services/scan-run.server";
import { enforceRateLimit, errorResponse, jsonResponse } from "../utils/api-helpers.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const limited = enforceRateLimit("scan", shop);
  if (limited) return limited;

  try {
    const result = await runScan({ admin, db, shop });
    return jsonResponse({ success: true, ...result });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "storesweep",
        message: "theme scan failed",
        shop,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    return errorResponse(
      error instanceof Error
        ? error.message
        : "StoreSweep could not scan the live theme.",
      500,
    );
  }
};
