/**
 * Append an audit event. Never throws: auditing must not break the
 * business action it is describing. A failed audit write is logged so
 * operators can notice the gap.
 */
export async function recordAudit(db, { shop, action, detail }) {
  try {
    await db.auditEvent.create({
      data: {
        shop,
        action,
        detail: detail === undefined ? null : JSON.stringify(detail),
      },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "storesweep",
        message: "audit write failed",
        shop,
        action,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function touchShop(db, shop, { scanCount = 0, cleanCount = 0, lastScanAt, lastThemePublishAt } = {}) {
  const data = { lastActiveAt: new Date() };
  if (scanCount) data.scanCount = { increment: scanCount };
  if (cleanCount) data.cleanCount = { increment: cleanCount };
  if (lastScanAt) data.lastScanAt = lastScanAt;
  if (lastThemePublishAt) data.lastThemePublishAt = lastThemePublishAt;

  await db.shop.upsert({
    where: { shop },
    update: data,
    create: { shop },
  });
}

export async function markShopUninstalled(db, shop) {
  await db.shop.upsert({
    where: { shop },
    update: { uninstalledAt: new Date() },
    create: { shop, uninstalledAt: new Date() },
  });
}

export default recordAudit;
