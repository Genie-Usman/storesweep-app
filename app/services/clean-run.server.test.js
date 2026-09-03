import test from "node:test";
import assert from "node:assert/strict";

import { contentChecksum } from "../utils/checksum.js";
import { identifyFindings } from "../utils/findings.js";
import { scanThemeFile } from "../utils/scanner.js";
import { runClean, ThemeChangedError } from "./clean-run.server.js";

const THEME_FILE = "layout/theme.liquid";
const TIDIO_TAG =
  '<script src="https://code.tidio.co/key.js"></script>';
const LOOX_SNIPPET = "{% render 'loox_inline' %}";
const THEME_CONTENT = `<html>\n${TIDIO_TAG}\n${LOOX_SNIPPET}\n</html>`;

function graphqlResponse(data) {
  return { json: async () => ({ data }) };
}

function fakeDb() {
  const created = {};
  return {
    created,
    scan: {
      create: async ({ data }) => ({ id: "scan-1", ...data }),
    },
    cleanOperation: {
      create: async ({ data }) => {
        created.cleanOperation = data;
        return { id: "clean-1", ...data };
      },
      findFirst: async () => null,
    },
    shop: {
      upsert: async ({ where }) => ({ shop: where.shop }),
    },
    auditEvent: {
      create: async ({ data }) => {
        created.audit = created.audit || [];
        created.audit.push(data);
        return { id: "audit-1" };
      },
    },
  };
}

function makeAdmin({ files, jobs = [] } = {}) {
  const upserts = [];
  const jobIds = [...jobs];
  return {
    upserts,
    graphql: async (query, options) => {
      if (/roles:\s*\[MAIN\]/.test(query)) {
        return graphqlResponse({
          themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/7" }] },
        });
      }

      if (/themeFilesUpsert/.test(query)) {
        const file = options.variables.files[0];
        upserts.push(file);
        return graphqlResponse({
          themeFilesUpsert: {
            job: { id: jobIds.shift() ?? null },
            upsertedThemeFiles: [{ filename: file.filename }],
            userErrors: [],
          },
        });
      }

      if (/job\(id:/.test(query)) {
        return graphqlResponse({ job: { done: true } });
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

function liveFindings() {
  return identifyFindings(
    scanThemeFile(THEME_CONTENT).map((finding) => ({
      ...finding,
      filename: THEME_FILE,
    })),
  );
}

test("backs up every file before writing cleaned content", async () => {
  const db = fakeDb();
  const admin = makeAdmin({ files: [{ filename: THEME_FILE, content: THEME_CONTENT }] });
  const findings = liveFindings();

  const result = await runClean({
    admin,
    db,
    shop: "shop.example",
    selectedFindingIds: findings.map((finding) => finding.id),
    fileChecksums: { [THEME_FILE]: contentChecksum(THEME_CONTENT) },
  });

  assert.equal(result.removedCount, 2);
  assert.equal(result.filesChanged, 1);

  const [backup, update] = admin.upserts;
  assert.equal(backup.filename, "layout/theme-storesweep-backup.liquid");
  assert.equal(backup.body.value, THEME_CONTENT);
  assert.equal(update.filename, THEME_FILE);
  assert.equal(update.body.value, "<html>\n\n\n</html>");

  assert.equal(db.created.cleanOperation.filesChanged, 1);
  const backups = JSON.parse(db.created.cleanOperation.backups);
  assert.equal(backups[0].originalFilename, THEME_FILE);
  assert.equal(backups[0].checksumBefore, contentChecksum(THEME_CONTENT));
});

test("cleans only the selected findings", async () => {
  const db = fakeDb();
  const admin = makeAdmin({ files: [{ filename: THEME_FILE, content: THEME_CONTENT }] });
  const [tidio] = liveFindings();

  const result = await runClean({
    admin,
    db,
    shop: "shop.example",
    selectedFindingIds: [tidio.id],
    fileChecksums: {},
  });

  assert.equal(result.removedCount, 1);
  const [, update] = admin.upserts;
  assert.equal(update.body.value.includes("code.tidio.co"), false);
  assert.equal(update.body.value.includes("loox_inline"), true);
});

test("rejects when the live theme no longer matches the scan", async () => {
  const db = fakeDb();
  const admin = makeAdmin({ files: [{ filename: THEME_FILE, content: THEME_CONTENT }] });
  const findings = liveFindings();

  await assert.rejects(
    runClean({
      admin,
      db,
      shop: "shop.example",
      selectedFindingIds: findings.map((finding) => finding.id),
      fileChecksums: { [THEME_FILE]: "stale-checksum" },
    }),
    (error) => {
      assert.ok(error instanceof ThemeChangedError);
      assert.match(error.message, /changed since this scan/);
      return true;
    },
  );
});

test("rejects when selected findings are gone from the live theme", async () => {
  const db = fakeDb();
  const admin = makeAdmin({ files: [{ filename: THEME_FILE, content: THEME_CONTENT }] });

  await assert.rejects(
    runClean({
      admin,
      db,
      shop: "shop.example",
      selectedFindingIds: ["finding:layout/theme.liquid:0-99999"],
      fileChecksums: {},
    }),
    (error) => {
      assert.ok(error instanceof ThemeChangedError);
      assert.match(error.message, /no longer present/);
      return true;
    },
  );
});

test("rejects malformed selections", async () => {
  const db = fakeDb();
  const admin = makeAdmin({ files: [{ filename: THEME_FILE, content: THEME_CONTENT }] });

  await assert.rejects(
    runClean({ admin, db, shop: "shop.example", selectedFindingIds: [] }),
    /non-empty array/,
  );
});
