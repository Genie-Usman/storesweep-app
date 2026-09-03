import { getMainTheme, getThemeTextFile, writeThemeFile } from "./theme-api.server.js";
import { waitForShopifyJob } from "./shopify-job.server.js";
import { recordAudit } from "./audit.server.js";
import { logger } from "../utils/logger.server.js";

/** Thrown when a restore cannot be completed safely. */
export class RestoreError extends Error {}

/**
 * Undo a cleaning run by copying every stored backup file back over its
 * original. Backups stay in the theme, so a restore can be repeated.
 */
export async function runRestore({ admin, db, shop, cleanOperationId }) {
  const operation = await db.cleanOperation.findFirst({
    where: { id: cleanOperationId, shop },
  });

  if (!operation) {
    throw new RestoreError("Cleaning operation was not found.");
  }

  if (operation.status !== "completed") {
    throw new RestoreError(
      `This cleaning operation cannot be restored (status: ${operation.status}).`,
    );
  }

  let backups;
  try {
    backups = JSON.parse(operation.backups || "[]");
  } catch {
    throw new RestoreError("The stored backup information is unreadable.");
  }

  if (!Array.isArray(backups) || backups.length === 0) {
    throw new RestoreError("This cleaning run has no backups to restore.");
  }

  await recordAudit(db, {
    shop,
    action: "restore.started",
    detail: { cleanId: operation.id, fileCount: backups.length },
  });

  const theme = await getMainTheme(admin);
  const restoredFiles = [];

  for (const { originalFilename, backupFilename } of backups) {
    const content = await getThemeTextFile(admin, theme.id, backupFilename);

    if (content === null) {
      throw new RestoreError(
        `The backup file ${backupFilename} is missing from the theme. Restore it manually or contact support.`,
      );
    }

    const update = await writeThemeFile(admin, theme.id, originalFilename, content);
    await waitForShopifyJob(admin, update.jobId);
    restoredFiles.push(originalFilename);
  }

  await db.cleanOperation.update({
    where: { id: operation.id },
    data: { status: "restored", restoredAt: new Date() },
  });

  await recordAudit(db, {
    shop,
    action: "restore.completed",
    detail: { cleanId: operation.id, restoredFiles },
  });

  logger.info("theme restore completed", {
    shop,
    cleanId: operation.id,
    restoredFiles,
  });

  return { cleanId: operation.id, restoredFiles };
}

export default runRestore;
