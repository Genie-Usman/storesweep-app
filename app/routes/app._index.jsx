import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { removeFindings } from "../utils/findings";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
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

export default function StoreSweepDashboard() {
  const scanFetcher = useFetcher();
  const cleanFetcher = useFetcher();
  const shopify = useAppBridge();
  const [scanResult, setScanResult] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [errorMessage, setErrorMessage] = useState("");
  const [writeAccessRequired, setWriteAccessRequired] = useState(null);

  const isScanning = scanFetcher.state !== "idle";
  const isCleaning = cleanFetcher.state !== "idle";
  const findings = useMemo(() => scanResult?.findings || [], [scanResult]);
  const allSelected =
    findings.length > 0 && selectedIds.size === findings.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const selectedFindings = useMemo(
    () => findings.filter((finding) => selectedIds.has(finding.id)),
    [findings, selectedIds],
  );

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
      shopify.toast.show(
        `${cleanFetcher.data.cleanedCount} code ${
          cleanFetcher.data.cleanedCount === 1 ? "block" : "blocks"
        } cleaned. Backup created.`,
      );
      setSelectedIds(new Set());
      setErrorMessage("");
      setWriteAccessRequired(null);
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
  }, [cleanFetcher.data, scanFetcher, shopify]);

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
    if (
      !scanResult ||
      selectedFindings.length === 0 ||
      writeAccessRequired
    ) {
      return;
    }

    try {
      const modifiedThemeCode = removeFindings(
        scanResult.themeContent,
        selectedFindings,
      );

      setErrorMessage("");
      cleanFetcher.submit(
        {
          modifiedThemeCode,
          selectedFindingIds: selectedFindings.map((finding) => finding.id),
          themeChecksum: scanResult.themeChecksum,
        },
        {
          method: "POST",
          action: "/api/theme/clean",
          encType: "application/json",
        },
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "The selected code could not be prepared safely.",
      );
    }
  };

  return (
    <s-page heading="StoreSweep">
      <s-button
        slot="primary-action"
        onClick={scanTheme}
        {...(isScanning ? { loading: true } : {})}
      >
        Scan live theme
      </s-button>

      <s-section heading="Find leftover app code">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            StoreSweep checks your published theme for code that may have been
            left behind by apps. Scanning does not change your store.
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

      {isScanning && !scanResult && (
        <s-section heading="Scanning your live theme">
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-spinner
              accessibilityLabel="Scanning the live theme"
              size="large"
            />
            <s-paragraph>
              Checking theme.liquid for recognizable leftover app code...
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

      {scanResult && findings.length === 0 && !isScanning && (
        <s-banner heading="No recognizable leftover code found" tone="success">
          StoreSweep did not find any known app signatures in your live
          theme.liquid file.
        </s-banner>
      )}

      {scanResult && findings.length > 0 && (
        <>
          <s-banner
            heading={`${findings.length} possible leftover ${
              findings.length === 1 ? "block" : "blocks"
            } found`}
            tone="warning"
          >
            Select only code you recognize as belonging to an app you no longer
            use. StoreSweep creates a backup before cleaning.
          </s-banner>

          <s-section heading="Review scan results" padding="none">
            <s-table {...(isScanning ? { loading: true } : {})}>
              <s-table-header-row>
                <s-table-header>
                  <s-checkbox
                    label="Select all"
                    checked={allSelected}
                    indeterminate={someSelected}
                    disabled={isCleaning}
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
                {findings.map((finding) => (
                  <s-table-row key={finding.id}>
                    <s-table-cell>
                      <s-checkbox
                        label={`Select ${finding.appName}`}
                        checked={selectedIds.has(finding.id)}
                        disabled={isCleaning}
                        onChange={(event) =>
                          toggleFinding(
                            finding.id,
                            event.currentTarget.checked,
                          )
                        }
                      />
                    </s-table-cell>
                    <s-table-cell>{finding.appName}</s-table-cell>
                    <s-table-cell>
                      {lineLabel(finding.lineNumbers)}
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
                ))}
              </s-table-body>
            </s-table>

            <s-box padding="base">
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button
                  variant="primary"
                  tone="critical"
                  disabled={
                    selectedIds.size === 0 ||
                    isScanning ||
                    Boolean(writeAccessRequired)
                  }
                  onClick={cleanSelectedCode}
                  {...(isCleaning ? { loading: true } : {})}
                >
                  Clean selected code
                </s-button>
                <s-paragraph>
                  {writeAccessRequired
                    ? "Automatic cleaning is unavailable until Shopify approves theme-file access."
                    : selectedIds.size === 0
                      ? "Select at least one result to clean."
                      : `${selectedIds.size} ${
                          selectedIds.size === 1 ? "result" : "results"
                        } selected.`}
                </s-paragraph>
              </s-stack>
            </s-box>
          </s-section>
        </>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
