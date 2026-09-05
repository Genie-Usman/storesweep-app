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
    case "finding.ignored":
      return "Finding ignored";
    case "finding.unignored":
      return "Ignore removed";
    case "app.ignored":
      return "App ignored";
    case "app.unignored":
      return "App ignore removed";
    default:
      return action;
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
          <s-text type="strong">{shop}</s-text>
          <s-grid gridTemplateColumns="repeat(3, 1fr)" gap="base">
            {statCard(String(stats.scanCount), "Scans run")}
            {statCard(String(stats.cleanCount), "Cleaning runs")}
            {statCard(stats.lastScanLabel || "—", "Last scan")}
          </s-grid>
          {stats.firstSeenLabel && (
            <s-text color="subdued">
              Using StoreSweep since {stats.firstSeenLabel}.
            </s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="How StoreSweep works">
        <s-stack direction="block" gap="base">
          <s-stack direction="block" gap="tight">
            <s-text type="strong">Scanning</s-text>
            <s-text color="subdued">
              Every scan reads the text files (liquid and JSON) of the
              selected theme and looks for code signatures left behind by
              uninstalled third-party apps. Binary assets such as images are
              never read, and scanning never writes to your store.
            </s-text>
          </s-stack>
          <s-divider direction="block" />
          <s-stack direction="block" gap="tight">
            <s-text type="strong">Cleaning</s-text>
            <s-text color="subdued">
              Cleaning only ever removes the exact code ranges you selected
              and reviewed. Before any file is changed, StoreSweep stores a
              backup copy of the original next to it, so every change can be
              restored with one click.
            </s-text>
          </s-stack>
          <s-divider direction="block" />
          <s-stack direction="block" gap="tight">
            <s-text type="strong">Your data</s-text>
            <s-text color="subdued">
              StoreSweep keeps no customer personal data. Scan results,
              cleaning history, and an audit trail are stored for your shop
              only, and are deleted 30 days after the app is uninstalled.
            </s-text>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section
        heading={`Audit trail (latest ${auditEvents.length})`}
        padding={auditEvents.length === 0 ? undefined : "none"}
      >
        {auditEvents.length === 0 ? (
          <s-text color="subdued">
            No activity recorded yet. Every scan and cleaning run is recorded
            here.
          </s-text>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">When</s-table-header>
              <s-table-header listSlot="secondary">Event</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {auditEvents.map((event) => (
                <s-table-row key={event.id}>
                  <s-table-cell>
                    <s-text type="strong">{event.createdAtLabel}</s-text>
                  </s-table-cell>
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
