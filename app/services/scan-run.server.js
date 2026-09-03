import { getMainTheme, listThemeTextFiles } from "./theme-api.server.js";
import { scanThemeFile } from "../utils/scanner.js";
import {
  identifyFindings,
  ignoredFindingKey,
  ignoredFindingRecordKey,
} from "../utils/findings.js";
import { contentChecksum } from "../utils/checksum.js";
import { recordAudit, touchShop } from "./audit.server.js";
import { logger } from "../utils/logger.server.js";

/**
 * Scan every text file in the store's published theme, persist the run,
 * and return a client-safe result (no theme source leaves the server).
 */
export async function runScan({ admin, db, shop }) {
  const startedAt = Date.now();
  const theme = await getMainTheme(admin);
  const files = await listThemeTextFiles(admin, theme.id);

  const fileChecksums = {};
  const findings = [];
  let ignoredCount = 0;

  const ignoredRecords = await db.ignoredFinding.findMany({ where: { shop } });
  const ignoredKeys = new Set(
    ignoredRecords.map((record) =>
      ignoredFindingRecordKey(record),
    ),
  );

  for (const { filename, content } of files) {
    fileChecksums[filename] = contentChecksum(content);
    const fileFindings = scanThemeFile(content).map((finding) => ({
      ...finding,
      filename,
    }));
    for (const finding of identifyFindings(fileFindings)) {
      if (
        ignoredKeys.has(
          ignoredFindingRecordKey(
            ignoredFindingKey({
              filename: finding.filename,
              appName: finding.appName,
              matchedCode: finding.matchedCode,
            }),
          ),
        )
      ) {
        ignoredCount += 1;
        continue;
      }
      findings.push(finding);
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
      shop,
      themeId: theme.id,
      themeName: theme.name ?? null,
      status: "completed",
      fileCount: files.length,
      findingCount: findings.length,
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
      durationMs,
    },
  });

  logger.info("theme scan completed", {
    shop,
    themeId: theme.id,
    fileCount: files.length,
    findingCount: findings.length,
    durationMs,
  });

  return {
    scanId: scanRecord.id,
    themeId: theme.id,
    themeName: theme.name ?? null,
    fileCount: files.length,
    findingCount: findings.length,
    ignoredCount,
    findings,
    fileChecksums,
    durationMs,
  };
}

export default runScan;
