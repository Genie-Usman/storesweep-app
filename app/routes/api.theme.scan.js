import { createHash } from "node:crypto";

import { authenticate } from "../shopify.server";
import {
  getMainThemeId,
  getThemeLiquid,
} from "../services/theme-api.server";
import { identifyFindings } from "../utils/findings";
import { scanThemeLiquid } from "../utils/scanner";

const checksum = (content) =>
  createHash("sha256").update(content, "utf8").digest("hex");

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    const themeId = await getMainThemeId(admin);
    const themeContent = await getThemeLiquid(admin, themeId);
    const findings = identifyFindings(scanThemeLiquid(themeContent));

    return Response.json(
      {
        success: true,
        findings,
        themeContent,
        themeChecksum: checksum(themeContent),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("StoreSweep theme scan failed", error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Theme scan failed.",
      },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
};
