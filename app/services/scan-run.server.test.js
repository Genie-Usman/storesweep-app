import test from "node:test";
import assert from "node:assert/strict";

import { contentChecksum } from "../utils/checksum.js";
import { runScan } from "./scan-run.server.js";

function graphqlResponse(data) {
  return { json: async () => ({ data }) };
}

function fakeDb({ ignored = [] } = {}) {
  const created = {};
  return {
    created,
    ignored,
    ignoredFinding: {
      findMany: async () => ignored,
    },
    scan: {
      create: async ({ data }) => {
        created.scan = data;
        return { id: "scan-1" };
      },
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
