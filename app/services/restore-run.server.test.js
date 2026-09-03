import test from "node:test";
import assert from "node:assert/strict";

import { runRestore, RestoreError } from "./restore-run.server.js";

const ORIGINAL = "layout/theme.liquid";
const BACKUP = "layout/theme-storesweep-backup.liquid";
const BACKUP_CONTENT = "<html>original</html>";

function graphqlResponse(data) {
  return { json: async () => ({ data }) };
}

function fakeDb({ operation } = {}) {
  const calls = { updates: [] };
  return {
    calls,
    cleanOperation: {
      findFirst: async () =>
        operation === undefined
          ? {
              id: "clean-1",
              shop: "shop.example",
              status: "completed",
              backups: JSON.stringify([
                {
                  originalFilename: ORIGINAL,
                  backupFilename: BACKUP,
                  checksumBefore: "abc",
                },
              ]),
            }
          : operation,
      update: async ({ where, data }) => {
        calls.updates.push({ where, data });
        return { id: where.id };
      },
    },
    auditEvent: {
      create: async () => ({ id: "audit-1" }),
    },
  };
}

function makeAdmin({ backupFiles } = {}) {
  const writes = [];
  return {
    writes,
    graphql: async (query, options) => {
      if (/roles:\s*\[MAIN\]/.test(query)) {
        return graphqlResponse({
          themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/7" }] },
        });
      }

      if (/themeFilesUpsert/.test(query)) {
        const file = options.variables.files[0];
        writes.push(file);
        return graphqlResponse({
          themeFilesUpsert: {
            job: null,
            upsertedThemeFiles: [{ filename: file.filename }],
            userErrors: [],
          },
        });
      }

      if (/filenames:/.test(query)) {
        const requested = options.variables.filenames[0];
        const content = backupFiles[requested];
        return graphqlResponse({
          theme: {
            files: {
              nodes:
                content === undefined
                  ? []
                  : [{ filename: requested, body: { content } }],
              userErrors: [],
            },
          },
        });
      }

      throw new Error(`Unexpected query: ${query}`);
    },
  };
}

test("copies each backup back over its original file", async () => {
  const db = fakeDb();
  const admin = makeAdmin({ backupFiles: { [BACKUP]: BACKUP_CONTENT } });

  const result = await runRestore({
    admin,
    db,
    shop: "shop.example",
    cleanOperationId: "clean-1",
  });

  assert.deepEqual(result.restoredFiles, [ORIGINAL]);
  assert.deepEqual(admin.writes, [
    { filename: ORIGINAL, body: { type: "TEXT", value: BACKUP_CONTENT } },
  ]);
  assert.equal(db.calls.updates.length, 1);
  assert.equal(db.calls.updates[0].data.status, "restored");
  assert.ok(db.calls.updates[0].data.restoredAt instanceof Date);
});

test("blocks when the backup file is missing from the theme", async () => {
  const db = fakeDb();
  const admin = makeAdmin({ backupFiles: {} });

  await assert.rejects(
    runRestore({
      admin,
      db,
      shop: "shop.example",
      cleanOperationId: "clean-1",
    }),
    (error) => {
      assert.ok(error instanceof RestoreError);
      assert.match(error.message, /missing from the theme/);
      return true;
    },
  );
});

test("blocks when the operation was already restored", async () => {
  const db = fakeDb({
    operation: { id: "clean-1", shop: "shop.example", status: "restored" },
  });
  const admin = makeAdmin({ backupFiles: { [BACKUP]: BACKUP_CONTENT } });

  await assert.rejects(
    runRestore({
      admin,
      db,
      shop: "shop.example",
      cleanOperationId: "clean-1",
    }),
    (error) => {
      assert.ok(error instanceof RestoreError);
      assert.match(error.message, /cannot be restored/);
      return true;
    },
  );
});

test("blocks when the operation belongs to another shop", async () => {
  const db = fakeDb();
  db.cleanOperation.findFirst = async () => null;
  const admin = makeAdmin({ backupFiles: { [BACKUP]: BACKUP_CONTENT } });

  await assert.rejects(
    runRestore({
      admin,
      db,
      shop: "other-shop.example",
      cleanOperationId: "clean-1",
    }),
    (error) => {
      assert.ok(error instanceof RestoreError);
      assert.match(error.message, /not found/);
      return true;
    },
  );
});
