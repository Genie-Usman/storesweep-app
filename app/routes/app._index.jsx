import { useEffect, useMemo, useRef, useState } from "react";
import {
  useFetcher,
  useLoaderData,
  useRevalidator,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSubscriptionStatus } from "../services/billing.server";
import { logger } from "../utils/logger.server";
import { getThemes } from "../services/theme-api.server";

const POLL_INTERVAL_MS = 1500;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export const loader = async ({ request }) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const shop = session.shop;

  const [lastScan, lastClean, ignoredFindings, ignoredApps, shopRecord, themes, subscription] =
    await Promise.all([
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
      db.ignoredFinding.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.ignoredApp.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.shop.findUnique({
        where: { shop },
        select: { lastThemePublishAt: true },
      }),
      getThemes(admin).catch((error) => {
        logger.error("theme list failed", { shop, error });
        return [];
      }),
      getSubscriptionStatus(billing),
    ]);

  return {
    lastScan:
      lastScan === null
        ? null
        : {
            scanId: lastScan.id,
            themeId: lastScan.themeId,
            themeName: lastScan.themeName,
            createdAtISO: lastScan.createdAt.toISOString(),
            createdAtLabel: `${dateFormatter.format(lastScan.createdAt)} UTC`,
            fileCount: lastScan.fileCount,
            findingCount: lastScan.findingCount,
            ignoredCount: lastScan.ignoredCount,
            fileChecksums: JSON.parse(lastScan.fileChecksums || "{}"),
            findings: lastScan.findings.map((finding) => ({
              id: finding.findingKey,
              filename: finding.filename,
              appName: finding.appName,
              category: finding.category,
              confidence: finding.confidence,
              matchedCode: finding.matchedCode,
              isNew: finding.isNew,
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
    ignoredFindings: ignoredFindings.map((record) => ({
      id: record.id,
      type: "finding",
      filename: record.filename,
      appName: record.appName,
    })),
    ignoredApps: ignoredApps.map((record) => ({
      id: record.id,
      type: "app",
      appName: record.appName,
    })),
    lastThemePublishAt: shopRecord?.lastThemePublishAt?.toISOString() ?? null,
    themes,
    billing: subscription,
  };
};

function codeSnippet(code, maximumLength = 140) {
  const compactCode = code.replace(/\s+/g, " ").trim();
  return compactCode.length > maximumLength
    ? `${compactCode.slice(0, maximumLength)}…`
    : compactCode;
}

function lineLabel({ start, end }) {
  return start === end ? `Line ${start}` : `Lines ${start}–${end}`;
}

function confidenceBadge(confidence) {
  switch (confidence) {
    case "high":
      return { tone: "info", label: "Dedicated app code" };
    case "medium":
      return { tone: "caution", label: "Vendor script" };
    case "low":
      return { tone: "neutral", label: "Often intentional" };
    default:
      return { tone: "neutral", label: "Review manually" };
  }
}

function statCard(value, label) {
  return (
    <s-grid-item>
      <s-box
        padding="base"
        borderRadius="base"
        background="subdued"
        min-height="100%"
      >
        <s-stack direction="block" gap="tight">
          <s-text type="strong">{value}</s-text>
          <s-text color="subdued">{label}</s-text>
        </s-stack>
      </s-box>
    </s-grid-item>
  );
}

export default function StoreSweepDashboard() {
  const loaderData = useLoaderData();
  const {
    lastClean,
    ignoredFindings,
    ignoredApps,
    lastThemePublishAt,
    themes,
    billing,
  } = loaderData;

  const startFetcher = useFetcher();
  const pollFetcher = useFetcher();
  const cleanFetcher = useFetcher();
  const restoreFetcher = useFetcher();
  const ignoreFetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();

  const mainTheme = themes.find((theme) => theme.role === "MAIN") || themes[0];
  const [selectedThemeId, setSelectedThemeId] = useState(mainTheme?.id ?? null);
  const [scanResult, setScanResult] = useState(
    loaderData.lastScan
      ? {
          scanId: loaderData.lastScan.scanId,
          themeId: loaderData.lastScan.themeId,
          themeName: loaderData.lastScan.themeName,
          createdAtLabel: loaderData.lastScan.createdAtLabel,
          fileCount: loaderData.lastScan.fileCount,
          findingCount: loaderData.lastScan.findingCount,
          ignoredCount: loaderData.lastScan.ignoredCount,
          newCount: 0,
          fileChecksums: loaderData.lastScan.fileChecksums,
          findings: loaderData.lastScan.findings,
        }
      : null,
  );
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [errorMessage, setErrorMessage] = useState("");
  const [writeAccessRequired, setWriteAccessRequired] = useState(null);
  const [upgradeRequired, setUpgradeRequired] = useState(false);
  const pollThemeRef = useRef(selectedThemeId);
  // startedAt of the job we already began polling for; guards against the
  // start/poll effects re-triggering each other in a loop.
  const handledScanRef = useRef(null);

  const scanStarting = startFetcher.state !== "idle";
  const scanJob = pollFetcher.data?.jobKey ? pollFetcher.data : null;
  const scanRunning =
    scanStarting || (scanJob ? scanJob.status === "running" : false);
  const isCleaning = cleanFetcher.state !== "idle";
  const isRestoring = restoreFetcher.state !== "idle";
  const isIgnoring = ignoreFetcher.state !== "idle";
  const isBusy = scanRunning || isCleaning || isRestoring || isIgnoring;
  const needsUpgrade = billing.enabled && !billing.subscribed;

  const findings = useMemo(() => scanResult?.findings || [], [scanResult]);
  const newCount = useMemo(
    () => findings.filter((finding) => finding.isNew).length,
    [findings],
  );
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

  const scanStale = Boolean(
    lastThemePublishAt &&
      loaderData.lastScan &&
      loaderData.lastScan.createdAtISO < lastThemePublishAt,
  );

  // Start polling exactly once per started scan job.
  useEffect(() => {
    const data = startFetcher.data;
    if (!data) return;

    if (
      data.success &&
      data.startedAt &&
      data.startedAt !== handledScanRef.current
    ) {
      handledScanRef.current = data.startedAt;
      pollThemeRef.current = data.themeId;
      pollFetcher.load(
        `/api/theme/scan?themeId=${encodeURIComponent(data.themeId || "")}`,
      );
    } else if (!data.success) {
      setErrorMessage(data.error || "The theme scan failed.");
    }
  }, [startFetcher.data, pollFetcher]);

  // Poll until the background job resolves, then adopt its result once.
  useEffect(() => {
    const data = pollFetcher.data;
    if (!data || !data.jobKey) return undefined;

    if (data.status === "running") {
      const timer = setTimeout(
        () =>
          pollFetcher.load(
            `/api/theme/scan?themeId=${encodeURIComponent(pollThemeRef.current || "")}`,
          ),
        POLL_INTERVAL_MS,
      );
      return () => clearTimeout(timer);
    }

    if (data.status === "completed" && data.result) {
      setScanResult(data.result);
      setSelectedIds(new Set());
      setErrorMessage("");
      revalidator.revalidate();
    } else if (data.status === "failed") {
      setErrorMessage(data.error || "The theme scan failed.");
    }
    return undefined;
  }, [pollFetcher.data, pollFetcher, revalidator]);

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
      setUpgradeRequired(false);
      revalidator.revalidate();
      setScanResult(null);
    } else if (cleanFetcher.data.code === "THEME_WRITE_ACCESS_REQUIRED") {
      setWriteAccessRequired({
        message: cleanFetcher.data.error,
        helpUrl: cleanFetcher.data.helpUrl,
      });
      setErrorMessage("");
    } else if (cleanFetcher.data.code === "UPGRADE_REQUIRED") {
      setUpgradeRequired(true);
      setErrorMessage("");
    } else {
      setErrorMessage(cleanFetcher.data.error || "Theme cleaning failed.");
    }
  }, [cleanFetcher.data, shopify, revalidator]);

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
    } else {
      setErrorMessage(restoreFetcher.data.error || "Restore failed.");
    }
  }, [restoreFetcher.data, shopify, revalidator]);

  useEffect(() => {
    if (!ignoreFetcher.data) return;

    if (ignoreFetcher.data.success) {
      revalidator.revalidate();
    } else {
      setErrorMessage(
        ignoreFetcher.data.error || "The ignore list change failed.",
      );
    }
  }, [ignoreFetcher.data, revalidator]);

  const startScan = (themeId) => {
    setSelectedThemeId(themeId);
    setErrorMessage("");
    startFetcher.submit(
      { themeId },
      {
        method: "POST",
        action: "/api/theme/scan",
        encType: "application/json",
      },
    );
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
        themeId: scanResult.themeId,
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

  const ignoreFinding = (finding) => {
    setErrorMessage("");
    ignoreFetcher.submit(
      {
        intent: "ignore",
        finding: {
          filename: finding.filename,
          appName: finding.appName,
          matchedCode: finding.matchedCode,
        },
      },
      {
        method: "POST",
        action: "/api/findings/ignore",
        encType: "application/json",
      },
    );
    setScanResult((current) =>
      current
        ? {
            ...current,
            findings: current.findings.filter(
              (candidate) => candidate.id !== finding.id,
            ),
          }
        : current,
    );
    setSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(finding.id);
      return nextIds;
    });
  };

  const ignoreApp = (name) => {
    setErrorMessage("");
    ignoreFetcher.submit(
      { intent: "ignore-app", appName: name },
      {
        method: "POST",
        action: "/api/findings/ignore",
        encType: "application/json",
      },
    );
    setScanResult((current) =>
      current
        ? {
            ...current,
            findings: current.findings.filter(
              (candidate) => candidate.appName !== name,
            ),
          }
        : current,
    );
    setSelectedIds(new Set());
  };

  const unignore = (record) => {
    setErrorMessage("");
    ignoreFetcher.submit(
      {
        intent: record.type === "app" ? "unignore-app" : "unignore",
        id: record.id,
      },
      {
        method: "POST",
        action: "/api/findings/ignore",
        encType: "application/json",
      },
    );
  };

  const progress = scanJob?.status === "running" ? scanJob.progress : null;
  const totalIgnored = ignoredFindings.length + ignoredApps.length;

  return (
    <s-page heading="StoreSweep">
      <s-button
        slot="primary-action"
        onClick={() => startScan(selectedThemeId)}
        disabled={scanRunning}
        {...(scanStarting ? { loading: true } : {})}
      >
        Scan theme
      </s-button>

      <s-section heading="Scan your theme">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">
            StoreSweep checks every text file in the selected theme for code
            left behind by uninstalled apps. Scanning never changes your
            store.
          </s-text>
          <s-stack direction="inline" gap="base" alignItems="end">
            {themes.length > 0 &&
              themes.map((theme) => (
                <s-button
                  key={theme.id}
                  variant={theme.id === selectedThemeId ? "primary" : "secondary"}
                  disabled={isBusy}
                  onClick={() => setSelectedThemeId(theme.id)}
                >
                  {theme.name}
                  {theme.role === "MAIN" ? " (live)" : ""}
                </s-button>
              ))}
            <s-button
              variant="primary"
              onClick={() => startScan(selectedThemeId)}
              disabled={scanRunning}
              {...(scanStarting ? { loading: true } : {})}
            >
              Scan theme
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>

      {needsUpgrade && (
        <s-banner heading="Cleaning requires StoreSweep Pro" tone="info">
          <s-paragraph>
            Scanning is free. Cleaning and restoring theme files require a
            StoreSweep Pro subscription.
          </s-paragraph>
          <s-link href="/app/billing">Upgrade to Pro</s-link>
        </s-banner>
      )}

      {upgradeRequired && !needsUpgrade && (
        <s-banner heading="Cleaning requires StoreSweep Pro" tone="warning">
          <s-paragraph>
            Your subscription is not active yet. Complete the Shopify
            subscription approval to start cleaning.
          </s-paragraph>
          <s-link href="/app/billing">Start Pro subscription</s-link>
        </s-banner>
      )}

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

      {scanRunning && (
        <s-section heading={progress ? "Scanning theme files" : "Starting scan"}>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-spinner
              accessibilityLabel="Scanning the theme"
              size="large"
            />
            <s-text color="subdued">
              {progress
                ? `Checked ${progress.filesScanned}${
                    progress.totalFiles ? ` of ${progress.totalFiles}` : ""
                  } files — ${progress.findingCount} findings so far.`
                : "Fetching the theme file list…"}
            </s-text>
          </s-stack>
        </s-section>
      )}

      {scanStale && !scanRunning && (
        <s-banner heading="This theme changed since your last scan" tone="info">
          The theme was published after your most recent scan. Scan again for
          fresh results.
        </s-banner>
      )}

      {!scanRunning && !scanResult && (
        <s-section heading="Ready when you are">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              Run a read-only scan to see anything apps may have left behind.
              StoreSweep always shows you what it found before anything is
              changed.
            </s-text>
            <s-button variant="primary" onClick={() => startScan(selectedThemeId)}>
              Scan {mainTheme?.name || "your theme"}
            </s-button>
          </s-stack>
        </s-section>
      )}

      {scanResult && !scanRunning && (
        <>
          <s-section
            heading={`Scan results${
              scanResult.themeName ? ` — ${scanResult.themeName}` : ""
            }`}
          >
            <s-stack direction="block" gap="base">
              <s-text color="subdued">
                {scanResult.createdAtLabel
                  ? `Completed ${scanResult.createdAtLabel}.`
                  : ""}
              </s-text>
              <s-grid
                gridTemplateColumns="repeat(4, 1fr)"
                gap="base"
              >
                {statCard(String(scanResult.fileCount), "Files scanned")}
                {statCard(String(findings.length), "Findings")}
                {statCard(String(newCount), "New since last scan")}
                {statCard(String(scanResult.ignoredCount || 0), "Hidden by ignore list")}
              </s-grid>
              {findings.length === 0 ? (
                <s-banner
                  heading="No recognizable leftover code found"
                  tone="success"
                >
                  StoreSweep did not find any known app signatures in this
                  theme.
                </s-banner>
              ) : (
                <s-banner
                  heading={`${findings.length} possible leftover ${
                    findings.length === 1 ? "block" : "blocks"
                  }${newCount > 0 ? `, ${newCount} new` : ""}`}
                  tone="warning"
                >
                  Select only code you recognize as belonging to an app you
                  no longer use. Every file is backed up before anything is
                  changed.
                </s-banner>
              )}
            </s-stack>
          </s-section>

          {findings.length > 0 && (
            <s-section heading="Review findings">
              <s-table>
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
                  <s-table-header listSlot="primary">
                    App or block
                  </s-table-header>
                  <s-table-header listSlot="inline">Location</s-table-header>
                  <s-table-header listSlot="secondary">
                    Code preview
                  </s-table-header>
                </s-table-header-row>

                <s-table-body>
                  {findingsByFile.map(([filename, fileFindings]) =>
                    fileFindings.map((finding) => {
                      const badge = confidenceBadge(finding.confidence);
                      return (
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
                              <s-stack direction="inline" gap="tight">
                                <s-text type="strong">
                                  {finding.appName}
                                </s-text>
                                {finding.isNew && (
                                  <s-badge tone="warning">New</s-badge>
                                )}
                              </s-stack>
                              <s-badge tone={badge.tone}>
                                {badge.label}
                              </s-badge>
                              <s-stack direction="inline" gap="tight">
                                <s-button
                                  disabled={isBusy}
                                  onClick={() => ignoreFinding(finding)}
                                >
                                  Keep this code
                                </s-button>
                                <s-button
                                  disabled={isBusy}
                                  onClick={() => ignoreApp(finding.appName)}
                                >
                                  Keep this app
                                </s-button>
                              </s-stack>
                            </s-stack>
                          </s-table-cell>
                          <s-table-cell>
                            <s-stack direction="block" gap="tight">
                              <s-text type="strong">{filename}</s-text>
                              <s-text color="subdued">
                                {lineLabel(finding.lineNumbers)}
                              </s-text>
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
                      );
                    }),
                  )}
                </s-table-body>
              </s-table>

              <s-box padding="base">
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-button
                    variant="primary"
                    tone="critical"
                    disabled={
                      selectedIds.size === 0 ||
                      isBusy ||
                      needsUpgrade ||
                      upgradeRequired
                    }
                    onClick={cleanSelectedCode}
                    {...(isCleaning ? { loading: true } : {})}
                  >
                    Clean selected code
                  </s-button>
                  <s-text color="subdued">
                    {selectedIds.size === 0
                      ? "Select at least one result to clean."
                      : `${selectedIds.size} ${
                          selectedIds.size === 1 ? "result" : "results"
                        } selected. The theme is re-verified server-side before writing.`}
                  </s-text>
                </s-stack>
              </s-box>
            </s-section>
          )}
        </>
      )}

      {lastClean && (
        <s-section heading="Last cleaning run">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              {lastClean.removedCount} code{" "}
              {lastClean.removedCount === 1 ? "block" : "blocks"} removed from{" "}
              {lastClean.filesChanged}{" "}
              {lastClean.filesChanged === 1 ? "file" : "files"} on{" "}
              {lastClean.createdAtLabel}. A full backup of every changed file
              was stored in your theme.
            </s-text>
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button
                onClick={restoreLastClean}
                disabled={isBusy || needsUpgrade || upgradeRequired}
                {...(isRestoring ? { loading: true } : {})}
              >
                Restore last cleaning run
              </s-button>
              <s-text color="subdued">
                Restoring copies the backed-up originals back over the
                cleaned files.
              </s-text>
            </s-stack>
          </s-stack>
        </s-section>
      )}

      {totalIgnored > 0 && (
        <s-section heading={`Ignore list (${totalIgnored})`}>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">App or block</s-table-header>
              <s-table-header listSlot="inline">Scope</s-table-header>
              <s-table-header listSlot="secondary"> </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {ignoredApps.map((record) => (
                <s-table-row key={record.id}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="tight">
                      <s-text type="strong">{record.appName}</s-text>
                      <s-badge tone="neutral">All matches</s-badge>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>Every file</s-table-cell>
                  <s-table-cell>
                    <s-button disabled={isBusy} onClick={() => unignore(record)}>
                      Stop ignoring
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
              {ignoredFindings.map((record) => (
                <s-table-row key={record.id}>
                  <s-table-cell>
                    <s-stack direction="inline" gap="tight">
                      <s-text type="strong">{record.appName}</s-text>
                      <s-badge tone="neutral">Exact code</s-badge>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{record.filename}</s-table-cell>
                  <s-table-cell>
                    <s-button disabled={isBusy} onClick={() => unignore(record)}>
                      Stop ignoring
                    </s-button>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();

  // Let Shopify's boundary handle thrown auth/OAuth responses (re-auth
  // redirects) and anything unexpected; render a recoverable page for
  // ordinary request errors.
  if (
    !error ||
    (typeof error === "object" && "status" in error && error.status >= 500)
  ) {
    return boundary.error(error);
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "statusText" in error
        ? `${error.status} ${error.statusText}`
        : "Something went wrong.";

  return (
    <s-page heading="StoreSweep">
      <s-banner heading="StoreSweep hit an unexpected error" tone="critical">
        <s-paragraph>{message}</s-paragraph>
        <s-paragraph>
          Try the action again. If it keeps happening, rescan the theme to
          refresh StoreSweep&apos;s view of your store.
        </s-paragraph>
      </s-banner>
      <s-link href="/app">Back to the dashboard</s-link>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
