import { getMainTheme, listThemeTextFiles, backupThemeFile, writeThemeFile } from "./theme-api.server.js";
import { waitForShopifyJob } from "./shopify-job.server.js";
import { scanThemeFile } from "../utils/scanner.js";
import { identifyFindings, removeFindings } from "../utils/findings.js";
import { contentChecksum } from "../utils/checksum.js";
import { recordAudit, touchShop } from "./audit.server.js";
import { logger } from "../utils/logger.server.js";

/** Thrown when the live theme no longer matches what the merchant reviewed. */
export class ThemeChangedError extends Error {}

const MAX_SELECTED_FINDINGS = 500;

/**
 * Server-authoritative cleaning. The client only ever sends the IDs of the
 * findings it reviewed plus the per-file checksums it saw at scan time; the
 * modified theme code is computed and verified entirely on the server.
 */
export async function runClean({
  admin,
  db,
  shop,
  scanId = null,
  selectedFindingIds,
  fileChecksums = {},
}) {
  if (
    !Array.isArray(selectedFindingIds) ||
    selectedFindingIds.length === 0 ||
    !selectedFindingIds.every((id) => typeof id === "string" && id.length > 0)
  ) {
    throw new TypeError("selectedFindingIds must be a non-empty array of strings.");
  }

  if (selectedFindingIds.length > MAX_SELECTED_FINDINGS) {
    throw new TypeError("Too many findings selected in one cleaning run.");
  }

  const uniqueSelectedIds = [...new Set(selectedFindingIds)];

  await recordAudit(db, {
    shop,
    action: "clean.started",
    detail: { selectedCount: uniqueSelectedIds.length, scanId },
  });

  const theme = await getMainTheme(admin);
  const files = await listThemeTextFiles(admin, theme.id);

  const liveFindingsById = new Map();
  const liveFiles = new Map();
  const liveChecksums = new Map();

  for (const { filename, content } of files) {
    const checksum = contentChecksum(content);
    liveChecksums.set(filename, checksum);

    if (
      typeof fileChecksums[filename] === "string" &&
      fileChecksums[filename] !== checksum
    ) {
      throw new ThemeChangedError(
        `${filename} changed since this scan. Scan again before cleaning.`,
      );
    }

    liveFiles.set(filename, content);
    const fileFindings = scanThemeFile(content).map((finding) => ({
      ...finding,
      filename,
    }));
    for (const finding of identifyFindings(fileFindings)) {
      liveFindingsById.set(finding.id, finding);
    }
  }

  const missingIds = uniqueSelectedIds.filter(
    (id) => !liveFindingsById.has(id),
  );
  if (missingIds.length > 0) {
    throw new ThemeChangedError(
      `${missingIds.length} selected ${
        missingIds.length === 1 ? "finding is" : "findings are"
      } no longer present. Scan again before cleaning.`,
    );
  }

  const selectedByFile = new Map();
  for (const id of uniqueSelectedIds) {
    const finding = liveFindingsById.get(id);
    if (!selectedByFile.has(finding.filename)) {
      selectedByFile.set(finding.filename, []);
    }
    selectedByFile.get(finding.filename).push(finding);
  }

  const cleanedFiles = [];
  for (const [filename, selectedFindings] of selectedByFile) {
    const cleanedContent = removeFindings(
      liveFiles.get(filename),
      selectedFindings,
    );
    if (cleanedContent !== liveFiles.get(filename)) {
      cleanedFiles.push({ filename, cleanedContent, removedCount: selectedFindings.length });
    }
  }

  if (cleanedFiles.length === 0) {
    throw new ThemeChangedError(
      "The selected code is no longer present in the live theme. Scan again.",
    );
  }

  // Phase 1: back up every file that is about to change, so a failed write
  // partway through still leaves a complete snapshot of the originals.
  const backups = [];
  for (const { filename } of cleanedFiles) {
    const backup = await backupThemeFile(
      admin,
      theme.id,
      filename,
      liveFiles.get(filename),
    );
    await waitForShopifyJob(admin, backup.jobId);
    backups.push({
      originalFilename: filename,
      backupFilename: backup.filename,
      checksumBefore: liveChecksums.get(filename),
    });
  }

  // Phase 2: write the cleaned files.
  for (const { filename, cleanedContent } of cleanedFiles) {
    const update = await writeThemeFile(admin, theme.id, filename, cleanedContent);
    await waitForShopifyJob(admin, update.jobId);
  }

  await touchShop(db, shop, { cleanCount: 1 });

  const operation = await db.cleanOperation.create({
    data: {
      shop,
      scanId,
      status: "completed",
      removedCount: cleanedFiles.reduce((total, file) => total + file.removedCount, 0),
      filesChanged: cleanedFiles.length,
      backups: JSON.stringify(backups),
    },
  });

  await recordAudit(db, {
    shop,
    action: "clean.completed",
    detail: {
      cleanId: operation.id,
      scanId,
      removedCount: operation.removedCount,
      filesChanged: cleanedFiles.length,
      backups: backups.map(({ originalFilename, backupFilename }) => ({
        originalFilename,
        backupFilename,
      })),
    },
  });

  logger.info("theme clean completed", {
    shop,
    cleanId: operation.id,
    removedCount: operation.removedCount,
    filesChanged: cleanedFiles.length,
  });

  return {
    cleanId: operation.id,
    removedCount: operation.removedCount,
    filesChanged: cleanedFiles.length,
    backups,
  };
}

export default runClean;
