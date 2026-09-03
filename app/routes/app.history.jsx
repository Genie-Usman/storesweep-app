import { useLoaderData } from "react-router";
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
        scan.durationMs === null ? null : Math.round(scan.durationMs / 100) / 10,
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

function statusLabel(status) {
  switch (status) {
    case "completed":
      return "Completed";
    case "restored":
      return "Restored after cleaning";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export default function StoreSweepHistory() {
  const { scans, cleanOperations } = useLoaderData();

  return (
    <s-page heading="History">
      <s-section heading={`Recent scans (${scans.length})`} padding="none">
        {scans.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>
              No scans yet. Run your first scan from the dashboard.
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">When</s-table-header>
              <s-table-header listSlot="inline">Theme</s-table-header>
              <s-table-header listSlot="inline">Files checked</s-table-header>
              <s-table-header listSlot="secondary">
                Findings
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {scans.map((scan) => (
                <s-table-row key={scan.id}>
                  <s-table-cell>{scan.createdAtLabel}</s-table-cell>
                  <s-table-cell>{scan.themeName}</s-table-cell>
                  <s-table-cell>{scan.fileCount}</s-table-cell>
                  <s-table-cell>
                    {scan.findingCount}
                    {scan.durationSeconds !== null
                      ? ` (in ${scan.durationSeconds}s)`
                      : ""}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section
        heading={`Recent cleaning runs (${cleanOperations.length})`}
        padding="none"
      >
        {cleanOperations.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>
              Nothing has been cleaned yet. StoreSweep records every cleaning
              run here so you can review or restore it later.
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">When</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header listSlot="secondary">
                Changes
              </s-table-header>
            </s-table-header-row>
            <s-table-body>
              {cleanOperations.map((operation) => (
                <s-table-row key={operation.id}>
                  <s-table-cell>{operation.createdAtLabel}</s-table-cell>
                  <s-table-cell>
                    {statusLabel(operation.status)}
                  </s-table-cell>
                  <s-table-cell>
                    {operation.removedCount} blocks across{" "}
                    {operation.filesChanged}{" "}
                    {operation.filesChanged === 1 ? "file" : "files"}
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
