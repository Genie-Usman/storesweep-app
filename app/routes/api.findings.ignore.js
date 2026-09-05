import { authenticate } from "../shopify.server";
import db from "../db.server";
import { recordAudit } from "../services/audit.server";
import { ignoredFindingKey } from "../utils/findings";
import { enforceRateLimit, errorResponse, jsonResponse, readJsonBody } from "../utils/api-helpers.server";

/**
 * Ignore a finding: the merchant reviewed it and wants scans to stop
 * surfacing this exact code in this file. Identity is (filename, appName,
 * hash of the matched code), so it survives unrelated file edits.
 */
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  if (request.method !== "POST") {
    return errorResponse("Method not allowed.", 405);
  }

  const limited = enforceRateLimit("ignore", shop);
  if (limited) return limited;

  const parsed = await readJsonBody(request);
  if (parsed.error) return errorResponse(parsed.error);

  const { intent, id, finding, appName } = parsed.body;

  if (intent === "ignore-app") {
    if (typeof appName !== "string" || !appName.trim()) {
      return errorResponse("An appName is required.");
    }

    const normalized = appName.trim();
    const record = await db.ignoredApp.upsert({
      where: { shop_appName: { shop, appName: normalized } },
      update: {},
      create: { shop, appName: normalized },
    });

    await recordAudit(db, {
      shop,
      action: "app.ignored",
      detail: { appName: normalized },
    });

    return jsonResponse({
      success: true,
      ignoredApp: { id: record.id, appName: record.appName },
    });
  }

  if (intent === "unignore-app") {
    if (typeof id !== "string" || !id) {
      return errorResponse("An ignored app id is required.");
    }

    const existing = await db.ignoredApp.findFirst({ where: { id, shop } });
    if (!existing) {
      return errorResponse("Ignored app was not found.", 404);
    }

    await db.ignoredApp.delete({ where: { id: existing.id } });
    await recordAudit(db, {
      shop,
      action: "app.unignored",
      detail: { appName: existing.appName },
    });

    return jsonResponse({ success: true });
  }

  if (intent === "unignore") {
    if (typeof id !== "string" || !id) {
      return errorResponse("An ignored finding id is required.");
    }

    const existing = await db.ignoredFinding.findFirst({
      where: { id, shop },
    });
    if (!existing) {
      return errorResponse("Ignored finding was not found.", 404);
    }

    await db.ignoredFinding.delete({ where: { id: existing.id } });
    await recordAudit(db, {
      shop,
      action: "finding.unignored",
      detail: { filename: existing.filename, appName: existing.appName },
    });

    return jsonResponse({ success: true });
  }

  if (
    !finding ||
    typeof finding.filename !== "string" ||
    typeof finding.appName !== "string" ||
    typeof finding.matchedCode !== "string"
  ) {
    return errorResponse(
      "A finding with filename, appName, and matchedCode is required.",
    );
  }

  const key = ignoredFindingKey(finding);

  const record = await db.ignoredFinding.upsert({
    where: {
      shop_filename_appName_codeHash: {
        shop,
        filename: key.filename,
        appName: key.appName,
        codeHash: key.codeHash,
      },
    },
    update: {},
    create: { shop, ...key },
  });

  await recordAudit(db, {
    shop,
    action: "finding.ignored",
    detail: { filename: key.filename, appName: key.appName },
  });

  return jsonResponse({
    success: true,
    ignored: { id: record.id, filename: record.filename, appName: record.appName },
  });
};
