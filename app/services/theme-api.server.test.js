import test from "node:test";
import assert from "node:assert/strict";

import {
  backupThemeLiquid,
  getMainThemeId,
  getThemeLiquid,
  updateThemeLiquid,
} from "./theme-api.server.js";

function graphqlResponse(data) {
  return { json: async () => ({ data }) };
}

test("gets the MAIN theme id", async () => {
  const admin = {
    graphql: async (query) => {
      assert.match(query, /roles:\s*\[MAIN\]/);
      return graphqlResponse({
        themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/123" }] },
      });
    },
  };

  assert.equal(
    await getMainThemeId(admin),
    "gid://shopify/OnlineStoreTheme/123",
  );
});

test("fetches layout/theme.liquid as text", async () => {
  const admin = {
    graphql: async (_query, options) => {
      assert.deepEqual(options.variables.filenames, ["layout/theme.liquid"]);
      return graphqlResponse({
        theme: {
          files: {
            nodes: [
              {
                filename: "layout/theme.liquid",
                body: { content: "<html></html>" },
              },
            ],
            userErrors: [],
          },
        },
      });
    },
  };

  assert.equal(await getThemeLiquid(admin, "theme-id"), "<html></html>");
});

test("writes backup and live theme files with TEXT bodies", async () => {
  const writes = [];
  const admin = {
    graphql: async (_query, options) => {
      writes.push(options.variables.files[0]);
      return graphqlResponse({
        themeFilesUpsert: {
          job: null,
          upsertedThemeFiles: [
            { filename: options.variables.files[0].filename },
          ],
          userErrors: [],
        },
      });
    },
  };

  await backupThemeLiquid(admin, "theme-id", "original");
  await updateThemeLiquid(admin, "theme-id", "updated");

  assert.deepEqual(writes, [
    {
      filename: "layout/theme-storesweep-backup.liquid",
      body: { type: "TEXT", value: "original" },
    },
    {
      filename: "layout/theme.liquid",
      body: { type: "TEXT", value: "updated" },
    },
  ]);
});

test("surfaces Shopify theme-file user errors", async () => {
  const admin = {
    graphql: async () =>
      graphqlResponse({
        themeFilesUpsert: {
          job: null,
          upsertedThemeFiles: [],
          userErrors: [{ field: ["files", "0"], message: "Access denied" }],
        },
      }),
  };

  await assert.rejects(
    updateThemeLiquid(admin, "theme-id", "updated"),
    /files\.0: Access denied/,
  );
});
