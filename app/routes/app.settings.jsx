import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import db from "../db.server";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

const AUDIT_LIMIT = 30;

function actionLabel(action) {
  switch (action) {
    case "scan.completed":
      return "Theme scanned";
    case "clean.started":
      return "Cleaning started";
    case "clean.completed":
      return "Theme cleaned";
    case "restore.started":
      return "Restore started";
    case "restore.completed":
      return "Backup restored";
    case "app.uninstalled":
      return "App uninstalled";
    default:
      return action;
  }
}

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [shopRecord, auditEvents] = await Promise.all([
    db.shop.findUnique({ where: { shop } }),
    db.auditEvent.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: AUDIT_LIMIT,
    }),
  ]);

  return {
    shop,
    stats: {
      scanCount: shopRecord?.scanCount ?? 0,
      cleanCount: shopRecord?.cleanCount ?? 0,
      firstSeenLabel: shopRecord
        ? `${dateFormatter.format(shopRecord.firstSeenAt)} UTC`
        : null,
      lastScanLabel:
        shopRecord && shopRecord.lastScanAt
          ? `${dateFormatter.format(shopRecord.lastScanAt)} UTC`
          : null,
    },
    auditEvents: auditEvents.map((event) => ({
      id: event.id,
      createdAtLabel: `${dateFormatter.format(event.createdAt)} UTC`,
      action: actionLabel(event.action),
    })),
  };
};

export default function StoreSweepSettings() {
  const { shop, stats, auditEvents } = useLoaderData();

  return (
    <s-page heading="Settings">
      <s-section heading="Store">
        <s-stack direction="block" gap="base">
          <s-paragraph>{shop}</s-paragraph>
          {stats.firstSeenLabel && (
            <s-paragraph>
              Using StoreSweep since {stats.firstSeenLabel}. {stats.scanCount}{" "}
              scans and {stats.cleanCount} cleaning runs to date.
            </s-paragraph>
          )}
          {stats.lastScanLabel && (
            <s-paragraph>
              Last scan: {stats.lastScanLabel}.
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section heading="What StoreSweep scans">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Every scan reads the text files (liquid and JSON) of your
            currently published theme and looks for code signatures left
            behind by uninstalled third-party apps. Binary assets such as
            images are never read, and scanning never writes to your store.
          </s-paragraph>
          <s-paragraph>
            Cleaning only ever removes the exact code ranges you selected and
            reviewed. Before any file is changed, StoreSweep stores a backup
            copy of the original next to it, so every change can be restored.
          </s-paragraph>
          <s-paragraph>
            StoreSweep keeps no customer personal data. Scan results,
            cleaning history, and an audit trail are stored for your shop
            only, and are deleted 30 days after the app is uninstalled.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading={`Audit trail (latest ${auditEvents.length})`} padding="none">
        {auditEvents.length === 0 ? (
          <s-box padding="base">
            <s-paragraph>
              No activity recorded yet. Every scan and cleaning run is
              recorded here.
            </s-paragraph>
          </s-box>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">When</s-table-header>
              <s-table-header listSlot="secondary">Event</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {auditEvents.map((event) => (
                <s-table-row key={event.id}>
                  <s-table-cell>{event.createdAtLabel}</s-table-cell>
                  <s-table-cell>{event.action}</s-table-cell>
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
