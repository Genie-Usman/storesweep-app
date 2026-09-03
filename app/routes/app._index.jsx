import { useEffect, useMemo, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [lastScan, lastClean] = await Promise.all([
    db.scan.findFirst({
      where: { shop, status: "completed" },
      orderBy: { createdAt: "desc" },
      include: {
        findings: { orderBy: [{ filename: "asc" }, { startLine: "asc" }] },
      },
    }),
    db.cleanOperation.findFirst({
      where: { shop, status: "completed" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    lastScan:
      lastScan === null
        ? null
        : {
            scanId: lastScan.id,
            themeName: lastScan.themeName,
            createdAtLabel: `${dateFormatter.format(lastScan.createdAt)} UTC`,
            fileCount: lastScan.fileCount,
            findingCount: lastScan.findingCount,
            fileChecksums: JSON.parse(lastScan.fileChecksums || "{}"),
            findings: lastScan.findings.map((finding) => ({
              id: finding.findingKey,
              filename: finding.filename,
              appName: finding.appName,
              category: finding.category,
              confidence: finding.confidence,
              matchedCode: finding.matchedCode,
              lineNumbers: { start: finding.startLine, end: finding.endLine },
            })),
          },
    lastClean:
      lastClean === null
        ? null
        : {
            cleanId: lastClean.id,
            createdAtLabel: `${dateFormatter.format(lastClean.createdAt)} UTC`,
            removedCount: lastClean.removedCount,
            filesChanged: lastClean.filesChanged,
          },
  };
};

function codeSnippet(code, maximumLength = 160) {
  const compactCode = code.replace(/\s+/g, " ").trim();
  return compactCode.length > maximumLength
    ? `${compactCode.slice(0, maximumLength)}...`
    : compactCode;
}

function lineLabel({ start, end }) {
  return start === end ? `Line ${start}` : `Lines ${start}-${end}`;
}

function confidenceLabel(confidence) {
  switch (confidence) {
    case "high":
      return "Dedicated app code";
    case "medium":
      return "Vendor script";
    case "low":
      return "Often intentional";
    default:
      return "Review manually";
  }
}

export default function StoreSweepDashboard() {
  const { lastScan: initialScan, lastClean } = useLoaderData();
  const scanFetcher = useFetcher();
  const cleanFetcher = useFetcher();
  const restoreFetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const [scanResult, setScanResult] = useState(
    initialScan
      ? {
          scanId: initialScan.scanId,
          themeName: initialScan.themeName,
          createdAtLabel: initialScan.createdAtLabel,
          fileCount: initialScan.fileCount,
          findingCount: initialScan.findingCount,
          fileChecksums: initialScan.fileChecksums,
          findings: initialScan.findings,
        }
      : null,
  );
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [errorMessage, setErrorMessage] = useState("");
  const [writeAccessRequired, setWriteAccessRequired] = useState(null);

  const isScanning = scanFetcher.state !== "idle";
  const isCleaning = cleanFetcher.state !== "idle";
  const isRestoring = restoreFetcher.state !== "idle";
  const isBusy = isScanning || isCleaning || isRestoring;

  const findings = useMemo(() => scanResult?.findings || [], [scanResult]);
  const findingsByFile = useMemo(() => {
    const grouped = new Map();
    for (const finding of findings) {
      if (!grouped.has(finding.filename)) grouped.set(finding.filename, []);
      grouped.get(finding.filename).push(finding);
    }
    return [...grouped.entries()];
  }, [findings]);

  const allSelected =
    findings.length > 0 && selectedIds.size === findings.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  useEffect(() => {
    if (!scanFetcher.data) return;

    if (scanFetcher.data.success) {
      setScanResult(scanFetcher.data);
      setSelectedIds(new Set());
      setErrorMessage("");
    } else {
      setErrorMessage(scanFetcher.data.error || "The theme scan failed.");
    }
  }, [scanFetcher.data]);

  useEffect(() => {
    if (!cleanFetcher.data) return;

    if (cleanFetcher.data.success) {
      const { removedCount, filesChanged } = cleanFetcher.data;
      shopify.toast.show(
        `${removedCount} code ${removedCount === 1 ? "block" : "blocks"} removed from ${filesChanged} ${
          filesChanged === 1 ? "file" : "files"
        }. Backups created.`,
      );
      setSelectedIds(new Set());
      setErrorMessage("");
      setWriteAccessRequired(null);
      revalidator.revalidate();
      scanFetcher.load("/api/theme/scan");
    } else if (cleanFetcher.data.code === "THEME_WRITE_ACCESS_REQUIRED") {
      setWriteAccessRequired({
        message: cleanFetcher.data.error,
        helpUrl: cleanFetcher.data.helpUrl,
      });
      setErrorMessage("");
    } else {
      setErrorMessage(cleanFetcher.data.error || "Theme cleaning failed.");
    }
  }, [cleanFetcher.data, scanFetcher, shopify, revalidator]);

  useEffect(() => {
    if (!restoreFetcher.data) return;

    if (restoreFetcher.data.success) {
      shopify.toast.show(
        `${restoreFetcher.data.restoredFiles.length} ${
          restoreFetcher.data.restoredFiles.length === 1 ? "file" : "files"
        } restored from backup.`,
      );
      setErrorMessage("");
      revalidator.revalidate();
      scanFetcher.load("/api/theme/scan");
    } else {
      setErrorMessage(restoreFetcher.data.error || "Restore failed.");
    }
  }, [restoreFetcher.data, scanFetcher, shopify, revalidator]);

  const scanTheme = () => {
    setErrorMessage("");
    scanFetcher.load("/api/theme/scan");
  };

  const toggleFinding = (findingId, checked) => {
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (checked) nextIds.add(findingId);
      else nextIds.delete(findingId);
      return nextIds;
    });
  };

  const toggleAll = (checked) => {
    setSelectedIds(
      checked ? new Set(findings.map((finding) => finding.id)) : new Set(),
    );
  };

  const cleanSelectedCode = () => {
    if (!scanResult || selectedIds.size === 0 || writeAccessRequired) return;

    setErrorMessage("");
    cleanFetcher.submit(
      {
        selectedFindingIds: [...selectedIds],
        fileChecksums: scanResult.fileChecksums || {},
        scanId: scanResult.scanId,
      },
      {
        method: "POST",
        action: "/api/theme/clean",
        encType: "application/json",
      },
    );
  };

  const restoreLastClean = () => {
    if (!lastClean || isBusy) return;
    setErrorMessage("");
    restoreFetcher.submit(
      { cleanOperationId: lastClean.cleanId },
      {
        method: "POST",
        action: "/api/theme/restore",
        encType: "application/json",
      },
    );
  };

  return (
    <s-page heading="StoreSweep">
      <s-button
        slot="primary-action"
        onClick={scanTheme}
        {...(isBusy ? { loading: true } : {})}
      >
        Scan live theme
      </s-button>

      <s-section heading="Find leftover app code">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            StoreSweep scans every text file in your published theme for code
            that may have been left behind by uninstalled apps. Scanning does
            not change your store.
          </s-paragraph>
          <s-paragraph>
            Review every match before cleaning. A detected app may still be
            installed or intentionally used by your theme.
          </s-paragraph>
        </s-stack>
      </s-section>

      {errorMessage && (
        <s-banner heading="StoreSweep needs your attention" tone="critical">
          {errorMessage}
        </s-banner>
      )}

      {writeAccessRequired && (
        <s-banner
          heading="Automatic cleaning needs Shopify approval"
          tone="warning"
        >
          <s-paragraph>{writeAccessRequired.message}</s-paragraph>
          <s-paragraph>
            The app developer must request protected theme-file access from
            Shopify. After Shopify approves the app, reload StoreSweep and try
            cleaning again.
          </s-paragraph>
          <s-link href={writeAccessRequired.helpUrl} target="_blank">
            Open Shopify&apos;s exemption request
          </s-link>
        </s-banner>
      )}

      {isScanning && (
        <s-section heading="Scanning your live theme">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-spinner
              accessibilityLabel="Scanning the live theme"
              size="large"
            />
            <s-paragraph>
              Checking every theme file for recognizable leftover app code...
            </s-paragraph>
          </s-stack>
        </s-section>
      )}

      {!isScanning && !scanResult && (
        <s-section heading="Ready to scan">
          <s-paragraph>
            Select &quot;Scan live theme&quot; to run a read-only check.
            StoreSweep will show anything it finds before making changes.
          </s-paragraph>
        </s-section>
      )}

      {scanResult && !isScanning && (
        <s-section heading={`Last scan${scanResult.createdAtLabel ? ` — ${scanResult.createdAtLabel}` : ""}`}>
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {scanResult.themeName
                ? `Theme: ${scanResult.themeName}. `
                : ""}
              {scanResult.fileCount} files checked.
            </s-paragraph>
            {findings.length === 0 ? (
              <s-banner
                heading="No recognizable leftover code found"
                tone="success"
              >
                StoreSweep did not find any known app signatures in your
                published theme.
              </s-banner>
            ) : (
              <s-banner
                heading={`${findings.length} possible leftover ${
                  findings.length === 1 ? "block" : "blocks"
                } found`}
                tone="warning"
              >
                Select only code you recognize as belonging to an app you no
                longer use. StoreSweep backs up every file before cleaning.
              </s-banner>
            )}
          </s-stack>
        </s-section>
      )}

      {scanResult && findings.length > 0 && (
        <s-section heading="Review scan results" padding="none">
          <s-table {...(isScanning ? { loading: true } : {})}>
            <s-table-header-row>
              <s-table-header>
                <s-checkbox
                  label="Select all"
                  checked={allSelected}
                  indeterminate={someSelected}
                  disabled={isBusy}
                  onChange={(event) =>
                    toggleAll(event.currentTarget.checked)
                  }
                />
              </s-table-header>
              <s-table-header listSlot="primary">App or block</s-table-header>
              <s-table-header listSlot="inline">Location</s-table-header>
              <s-table-header listSlot="secondary">
                Code preview
              </s-table-header>
            </s-table-header-row>

            <s-table-body>
              {findingsByFile.map(([filename, fileFindings]) =>
                fileFindings.map((finding) => (
                  <s-table-row key={finding.id}>
                    <s-table-cell>
                      <s-checkbox
                        label={`Select ${finding.appName}`}
                        checked={selectedIds.has(finding.id)}
                        disabled={isBusy}
                        onChange={(event) =>
                          toggleFinding(
                            finding.id,
                            event.currentTarget.checked,
                          )
                        }
                      />
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="tight">
                        <s-paragraph>{finding.appName}</s-paragraph>
                        <s-paragraph>
                          {confidenceLabel(finding.confidence)}
                        </s-paragraph>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="tight">
                        <s-paragraph>{filename}</s-paragraph>
                        <s-paragraph>
                          {lineLabel(finding.lineNumbers)}
                        </s-paragraph>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-box
                        padding="small"
                        borderRadius="base"
                        background="subdued"
                      >
                        <code>{codeSnippet(finding.matchedCode)}</code>
                      </s-box>
                    </s-table-cell>
                  </s-table-row>
                )),
              )}
            </s-table-body>
          </s-table>

          <s-box padding="base">
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button
                variant="primary"
                tone="critical"
                disabled={selectedIds.size === 0 || isBusy}
                onClick={cleanSelectedCode}
                {...(isCleaning ? { loading: true } : {})}
              >
                Clean selected code
              </s-button>
              <s-paragraph>
                {selectedIds.size === 0
                  ? "Select at least one result to clean."
                  : `${selectedIds.size} ${
                      selectedIds.size === 1 ? "result" : "results"
                    } selected. Server-side verification will re-check the theme before writing.`}
              </s-paragraph>
            </s-stack>
          </s-box>
        </s-section>
      )}

      {lastClean && (
        <s-section heading="Last cleaning run">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              {lastClean.removedCount} code{" "}
              {lastClean.removedCount === 1 ? "block" : "blocks"} removed from{" "}
              {lastClean.filesChanged}{" "}
              {lastClean.filesChanged === 1 ? "file" : "files"} on{" "}
              {lastClean.createdAtLabel}. A full backup of every changed file
              was stored in your theme.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-button
                onClick={restoreLastClean}
                disabled={isBusy}
                {...(isRestoring ? { loading: true } : {})}
              >
                Restore last cleaning run
              </s-button>
              <s-paragraph>
                Restoring copies the backed-up originals back over the cleaned
                files.
              </s-paragraph>
            </s-stack>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
