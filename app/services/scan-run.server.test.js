import test from "node:test";
import assert from "node:assert/strict";

import { contentChecksum } from "../utils/checksum.js";
import { runScan } from "./scan-run.server.js";

function graphqlResponse(data) {
  return { json: async () => ({ data }) };
}

function fakeDb({ ignored = [], ignoredApps = [], previousScan = null } = {}) {
  const created = {};
  return {
    created,
    ignored,
    ignoredFinding: {
      findMany: async () => ignored,
    },
    ignoredApp: {
      findMany: async () => ignoredApps,
    },
    scan: {
      findFirst: async () => previousScan,
      create: async ({ data }) => {
        created.scan = data;
        return { id: "scan-1" };
      },
    },
    scanFinding: {
      findMany: async () => previousScan?.findings ?? [],
    },
    shop: {
      upsert: async ({ where, update, create }) => {
        created.shopUpsert = { where, update, create };
        return { shop: where.shop };
      },
    },
    auditEvent: {
      create: async ({ data }) => {
        created.audit = data;
        return { id: "audit-1" };
      },
    },
  };
}

function adminWithFiles(files) {
  return {
    graphql: async (query) => {
      if (/roles:\s*\[MAIN\]/.test(query)) {
        return graphqlResponse({
          themes: {
            nodes: [{ id: "gid://shopify/OnlineStoreTheme/7", name: "Dawn" }],
          },
        });
      }

      return graphqlResponse({
        theme: {
          files: {
            nodes: files.map(({ filename, content }) => ({
              filename,
              body: { content },
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
            userErrors: [],
          },
        },
      });
    },
  };
}

test("persists a scan and returns client-safe results", async () => {
  const db = fakeDb();
  const admin = adminWithFiles([
    {
      filename: "layout/theme.liquid",
      content:
        '<script src="https://code.tidio.co/key.js"></script>\n{% render \'loox_inline\' %}',
    },
    { filename: "templates/product.json", content: "{}" },
  ]);

  const result = await runScan({ admin, db, shop: "shop.example" });

  assert.equal(result.fileCount, 2);
  assert.equal(result.findingCount, 2);
  assert.equal(result.themeName, "Dawn");
  assert.deepEqual(
    result.findings.map((finding) => finding.filename),
    ["layout/theme.liquid", "layout/theme.liquid"],
  );
  assert.ok(result.fileChecksums["templates/product.json"]);
  assert.equal("themeContent" in result, false);

  assert.equal(db.created.scan.shop, "shop.example");
  assert.equal(db.created.scan.findingCount, 2);
  assert.equal(db.created.scan.findings.create.length, 2);
  assert.equal(db.created.scan.findings.create[0].findingKey.startsWith("finding:"), true);
  assert.equal(db.created.audit.action, "scan.completed");
});

test("checksums are stable and content-derived", async () => {
  const db = fakeDb();
  const content = "<html></html>";
  const admin = adminWithFiles([{ filename: "layout/theme.liquid", content }]);

  const result = await runScan({ admin, db, shop: "shop.example" });

  assert.equal(result.fileChecksums["layout/theme.liquid"], contentChecksum(content));
});

test("findings matching the ignore list are hidden and counted", async () => {
  const TIDIO =
    '<script src="https://code.tidio.co/key.js"></script>';
  const { ignoredFindingKey } = await import("../utils/findings.js");
  const ignore = ignoredFindingKey({
    filename: "layout/theme.liquid",
    appName: "Tidio Live Chat",
    matchedCode: TIDIO,
  });
  const db = fakeDb({
    ignored: [{ id: "ign-1", shop: "shop.example", ...ignore }],
  });
  const admin = adminWithFiles([
    {
      filename: "layout/theme.liquid",
      content: `${TIDIO}\n{% render 'loox_inline' %}`,
    },
  ]);

  const result = await runScan({ admin, db, shop: "shop.example" });

  assert.equal(result.findingCount, 1);
  assert.equal(result.ignoredCount, 1);
  assert.equal(result.findings[0].appName, "Loox Product Reviews");
  assert.equal(db.created.scan.findingCount, 1);
});

function adminWithThemeAndFiles(files) {
  return {
    graphql: async (query) => {
      if (/roles:\s*\[MAIN\]/.test(query)) {
        return graphqlResponse({
          themes: {
            nodes: [{ id: "gid://shopify/OnlineStoreTheme/7", name: "Dawn" }],
          },
        });
      }

      if (/query StoreSweepTheme\b/.test(query)) {
        return graphqlResponse({
          theme: { id: "gid://shopify/OnlineStoreTheme/9", name: "Draft" },
        });
      }

      return graphqlResponse({
        theme: {
          files: {
            nodes: files.map(({ filename, content }) => ({
              filename,
              body: { content },
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
            userErrors: [],
          },
        },
      });
    },
  };
}

const TIDIO_TAG = '<script src="https://code.tidio.co/key.js"></script>';

test("flags findings as new when they were absent from the previous scan", async () => {
  const previousFindings = [
    {
      filename: "layout/theme.liquid",
      appName: "Loox Product Reviews",
      matchedCode: "{% render 'loox_inline' %}",
    },
  ];
  const db = fakeDb({
    previousScan: { id: "scan-0", findings: previousFindings },
  });
  const admin = adminWithFiles([
    {
      filename: "layout/theme.liquid",
      content: `${TIDIO_TAG}\n{% render 'loox_inline' %}`,
    },
  ]);

  const result = await runScan({ admin, db, shop: "shop.example" });

  assert.equal(result.findingCount, 2);
  assert.equal(result.newCount, 1);
  const persisted = db.created.scan.findings.create;
  assert.equal(
    persisted.find((finding) => finding.appName === "Tidio Live Chat").isNew,
    true,
  );
  assert.equal(
    persisted.find((finding) => finding.appName === "Loox Product Reviews")
      .isNew,
    false,
  );
});

test("app-level ignores hide every match for an app", async () => {
  const db = fakeDb({ ignoredApps: [{ id: "app-1", appName: "Tidio Live Chat" }] });
  const admin = adminWithFiles([
    {
      filename: "layout/theme.liquid",
      content: `${TIDIO_TAG}\n{% render 'loox_inline' %}`,
    },
  ]);

  const result = await runScan({ admin, db, shop: "shop.example" });

  assert.equal(result.findingCount, 1);
  assert.equal(result.ignoredCount, 1);
  assert.equal(result.findings[0].appName, "Loox Product Reviews");
});

test("reports progress after each file is scanned", async () => {
  const progress = [];
  const db = fakeDb();
  const admin = adminWithFiles([
    { filename: "layout/theme.liquid", content: TIDIO_TAG },
    { filename: "templates/product.json", content: "{}" },
  ]);

  await runScan({
    admin,
    db,
    shop: "shop.example",
    onProgress: (snapshot) => progress.push({ ...snapshot }),
  });

  assert.deepEqual(
    progress.map((step) => step.filesScanned),
    [1, 2],
  );
  assert.equal(progress[1].totalFiles, 2);
  assert.equal(progress[1].findingCount, 1);
});

test("scans an arbitrary theme when themeId is provided", async () => {
  const db = fakeDb();
  const admin = adminWithThemeAndFiles([
    { filename: "sections/footer.liquid", content: TIDIO_TAG },
  ]);

  const result = await runScan({
    admin,
    db,
    shop: "shop.example",
    themeId: "gid://shopify/OnlineStoreTheme/9",
  });

  assert.equal(result.themeName, "Draft");
  assert.equal(result.findingCount, 1);
  assert.equal(db.created.scan.themeId, "gid://shopify/OnlineStoreTheme/9");
});
