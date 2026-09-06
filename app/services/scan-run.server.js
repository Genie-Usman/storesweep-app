import { getMainTheme, getTheme, listThemeTextFiles } from "./theme-api.server.js";
import { scanThemeFile } from "../utils/scanner.js";
import {
  identifyFindings,
  ignoredFindingKey,
  ignoredFindingRecordKey,
} from "../utils/findings.js";
import { contentChecksum } from "../utils/checksum.js";
import { recordAudit, touchShop } from "./audit.server.js";
import { logger } from "../utils/logger.server.js";

/** Signature used both for ignore matching and scan-to-scan diffing. */
function findingSignature({ filename, appName, matchedCode }) {
  return ignoredFindingRecordKey({
    ...ignoredFindingKey({ filename, appName, matchedCode }),
  });
}

/**
 * Scan a theme's text files, persist the run, and return a client-safe
 * result (no theme source leaves the server).
 *
 * - `themeId` targets any theme; null scans the published theme.
 * - `onProgress({ filesScanned, totalFiles, findingCount, ignoredCount })`
 *   fires per file for background-job progress reporting.
 * - Findings are compared against the previous completed scan of the same
 *   theme and flagged `isNew` when their exact signature is new.
 */
export async function runScan({
  admin,
  db,
  shop,
  themeId = null,
  onProgress = null,
}) {
  const startedAt = Date.now();
  const theme = themeId
    ? await getTheme(admin, themeId)
    : await getMainTheme(admin);
  const files = await listThemeTextFiles(admin, theme.id);

  const [ignoredRecords, ignoredApps] = await Promise.all([
    db.ignoredFinding.findMany({ where: { shop } }),
    db.ignoredApp.findMany({ where: { shop } }),
  ]);
  const ignoredKeys = new Set(
    ignoredRecords.map((record) => ignoredFindingRecordKey(record)),
  );
  const ignoredAppNames = new Set(ignoredApps.map((app) => app.appName));

  // Diff baseline: the previous completed scan of this same theme.
  const previousScan = await db.scan.findFirst({
    where: { shop, themeId: theme.id, status: "completed" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const previousSignatures = new Set(
    previousScan
      ? (
          await db.scanFinding.findMany({
            where: { scanId: previousScan.id },
            select: { filename: true, appName: true, matchedCode: true },
          })
        ).map((finding) => findingSignature(finding))
      : [],
  );

  const fileChecksums = {};
  const findings = [];
  let ignoredCount = 0;
  let filesScanned = 0;

  for (const { filename, content } of files) {
    fileChecksums[filename] = contentChecksum(content);
    const fileFindings = scanThemeFile(content).map((finding) => ({
      ...finding,
      filename,
    }));
    for (const finding of identifyFindings(fileFindings)) {
      if (ignoredAppNames.has(finding.appName)) {
        ignoredCount += 1;
        continue;
      }
      if (
        ignoredKeys.has(
          findingSignature({
            filename: finding.filename,
            appName: finding.appName,
            matchedCode: finding.matchedCode,
          }),
        )
      ) {
        ignoredCount += 1;
        continue;
      }
      findings.push({
        ...finding,
        isNew: !previousSignatures.has(
          findingSignature({
            filename: finding.filename,
            appName: finding.appName,
            matchedCode: finding.matchedCode,
          }),
        ),
      });
    }

    filesScanned += 1;
    if (onProgress) {
      onProgress({
        filesScanned,
        totalFiles: files.length,
        findingCount: findings.length,
        ignoredCount,
      });
    }
  }

  findings.sort(
    (left, right) =>
      left.filename.localeCompare(right.filename) ||
      left.startIndex - right.startIndex,
  );

  const durationMs = Date.now() - startedAt;

  await touchShop(db, shop, { scanCount: 1, lastScanAt: new Date() });

  const scanRecord = await db.scan.create({
    data: {
      // A create with nested writes (findings) requires the relation form;
      // the scalar shop foreign key is rejected in that combination.
      shopRef: { connect: { shop } },
      themeId: theme.id,
      themeName: theme.name ?? null,
      status: "completed",
      fileCount: files.length,
      findingCount: findings.length,
      ignoredCount,
      durationMs,
      fileChecksums: JSON.stringify(fileChecksums),
      findings: {
        create: findings.map((finding) => ({
          findingKey: finding.id,
          filename: finding.filename,
          appName: finding.appName,
          category: finding.category ?? null,
          confidence: finding.confidence ?? null,
          matchedCode: finding.matchedCode,
          startLine: finding.lineNumbers.start,
          endLine: finding.lineNumbers.end,
          isNew: finding.isNew,
        })),
      },
    },
  });

  await recordAudit(db, {
    shop,
    action: "scan.completed",
    detail: {
      scanId: scanRecord.id,
      themeId: theme.id,
      fileCount: files.length,
      findingCount: findings.length,
      ignoredCount,
      newCount: findings.filter((finding) => finding.isNew).length,
      durationMs,
    },
  });

  logger.info("theme scan completed", {
    shop,
    themeId: theme.id,
    fileCount: files.length,
    findingCount: findings.length,
    ignoredCount,
    durationMs,
  });

  return {
    scanId: scanRecord.id,
    themeId: theme.id,
    themeName: theme.name ?? null,
    fileCount: files.length,
    findingCount: findings.length,
    newCount: findings.filter((finding) => finding.isNew).length,
    ignoredCount,
    findings,
    fileChecksums,
    durationMs,
  };
}

export default runScan;
