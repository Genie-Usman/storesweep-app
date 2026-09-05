import { useEffect } from "react";
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

const HISTORY_LIMIT = 25;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [scans, cleanOperations] = await Promise.all([
    db.scan.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        createdAt: true,
        themeName: true,
        fileCount: true,
        findingCount: true,
        durationMs: true,
      },
    }),
    db.cleanOperation.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        createdAt: true,
        status: true,
        removedCount: true,
        filesChanged: true,
      },
    }),
  ]);

  return {
    scans: scans.map((scan) => ({
      id: scan.id,
      createdAtLabel: `${dateFormatter.format(scan.createdAt)} UTC`,
      themeName: scan.themeName || "Published theme",
      fileCount: scan.fileCount,
      findingCount: scan.findingCount,
      durationSeconds:
        scan.durationMs === null
          ? null
          : Math.round(scan.durationMs / 100) / 10,
    })),
    cleanOperations: cleanOperations.map((operation) => ({
      id: operation.id,
      createdAtLabel: `${dateFormatter.format(operation.createdAt)} UTC`,
      status: operation.status,
      removedCount: operation.removedCount,
      filesChanged: operation.filesChanged,
    })),
  };
};

function statusBadge(status) {
  switch (status) {
    case "completed":
      return { tone: "success", label: "Completed" };
    case "restored":
      return { tone: "info", label: "Restored" };
    case "failed":
      return { tone: "critical", label: "Failed" };
    default:
      return { tone: "neutral", label: status };
  }
}

export default function StoreSweepHistory() {
  const { scans, cleanOperations } = useLoaderData();
  const restoreFetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const isRestoring = restoreFetcher.state !== "idle";

  useEffect(() => {
    if (!restoreFetcher.data) return;

    if (restoreFetcher.data.success) {
      shopify.toast.show(
        `${restoreFetcher.data.restoredFiles.length} ${
          restoreFetcher.data.restoredFiles.length === 1 ? "file" : "files"
        } restored from backup.`,
      );
      revalidator.revalidate();
    } else {
      shopify.toast.show(restoreFetcher.data.error || "Restore failed.", {
        isError: true,
      });
    }
  }, [restoreFetcher.data, revalidator, shopify]);

  const restoreOperation = (operation) => {
    restoreFetcher.submit(
      { cleanOperationId: operation.id },
      {
        method: "POST",
        action: "/api/theme/restore",
        encType: "application/json",
      },
    );
  };

  return (
    <s-page heading="History">
      <s-section
        heading={`Scans (${scans.length})`}
        padding={scans.length === 0 ? undefined : "none"}
      >
        {scans.length === 0 ? (
          <s-text color="subdued">
            No scans yet. Run your first scan from the dashboard.
          </s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">When</s-table-header>
              <s-table-header listSlot="inline">Theme</s-table-header>
              <s-table-header listSlot="inline">Files</s-table-header>
              <s-table-header listSlot="secondary">Findings</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {scans.map((scan) => (
                <s-table-row key={scan.id}>
                  <s-table-cell>
                    <s-text type="strong">{scan.createdAtLabel}</s-text>
                  </s-table-cell>
                  <s-table-cell>{scan.themeName}</s-table-cell>
                  <s-table-cell>{scan.fileCount}</s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="tight" alignItems="center">
                      {scan.findingCount > 0 ? (
                        <s-badge
                          tone={scan.findingCount > 0 ? "warning" : "success"}
                        >
                          {scan.findingCount}
                        </s-badge>
                      ) : (
                        <s-badge tone="success">Clear</s-badge>
                      )}
                      {scan.durationSeconds !== null && (
                        <s-text color="subdued">
                          in {scan.durationSeconds}s
                        </s-text>
                      )}
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section
        heading={`Cleaning runs (${cleanOperations.length})`}
        padding={cleanOperations.length === 0 ? undefined : "none"}
      >
        {cleanOperations.length === 0 ? (
          <s-text color="subdued">
            Nothing has been cleaned yet. Every cleaning run is recorded here
            so you can review or restore it later.
          </s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">When</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header listSlot="secondary">Changes</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {cleanOperations.map((operation) => {
                const badge = statusBadge(operation.status);
                return (
                  <s-table-row key={operation.id}>
                    <s-table-cell>
                      <s-text type="strong">{operation.createdAtLabel}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={badge.tone}>{badge.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="block" gap="tight">
                        <s-text>
                          {operation.removedCount} blocks across{" "}
                          {operation.filesChanged}{" "}
                          {operation.filesChanged === 1 ? "file" : "files"}
                        </s-text>
                        {operation.status === "completed" && (
                          <s-button
                            disabled={isRestoring}
                            onClick={() => restoreOperation(operation)}
                          >
                            Restore
                          </s-button>
                        )}
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
