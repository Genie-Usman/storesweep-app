import test from "node:test";
import assert from "node:assert/strict";

import {
  backupFilenameFor,
  isStoresweepBackupFile,
  isTextThemeFile,
  listThemeTextFiles,
  originalFilenameForBackup,
} from "./theme-api.server.js";

function graphqlResponse(data) {
  return { json: async () => ({ data }) };
}

test("classifies scannable text files", () => {
  assert.equal(isTextThemeFile("layout/theme.liquid"), true);
  assert.equal(isTextThemeFile("templates/product.json"), true);
  assert.equal(isTextThemeFile("assets/logo.png"), false);
  assert.equal(isTextThemeFile(undefined), false);
});

test("recognizes StoreSweep backup files as unscannable", () => {
  assert.equal(
    isStoresweepBackupFile("layout/theme-storesweep-backup.liquid"),
    true,
  );
  assert.equal(isStoresweepBackupFile("layout/theme.liquid"), false);
});

test("maps filenames to backup names and back", () => {
  assert.equal(
    backupFilenameFor("layout/theme.liquid"),
    "layout/theme-storesweep-backup.liquid",
  );
  assert.equal(
    backupFilenameFor("sections/header.liquid"),
    "sections/header-storesweep-backup.liquid",
  );
  assert.equal(
    originalFilenameForBackup("sections/header-storesweep-backup.liquid"),
    "sections/header.liquid",
  );
});

test("pages through theme files and keeps only scannable text content", async () => {
  const pages = [
    {
      files: {
        nodes: [
          { filename: "layout/theme.liquid", body: { content: "<html>" } },
          { filename: "assets/logo.png", body: { content: "base64junk" } },
          { filename: "assets/pixel.js", body: { content: "var x = 1;" } },
        ],
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
        userErrors: [],
      },
    },
    {
      files: {
        nodes: [
          {
            filename: "layout/theme-storesweep-backup.liquid",
            body: { content: "old backup" },
          },
          { filename: "sections/header.liquid", body: { content: "{% %}" } },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
        userErrors: [],
      },
    },
  ];

  const cursors = [];
  const admin = {
    graphql: async (_query, options) => {
      cursors.push(options.variables.after);
      return graphqlResponse({ theme: pages[cursors.length - 1] });
    },
  };

  const files = await listThemeTextFiles(admin, "theme-id", { pageSize: 2 });

  assert.deepEqual(cursors, [null, "cursor-1"]);
  assert.deepEqual(files, [
    { filename: "layout/theme.liquid", content: "<html>" },
    { filename: "sections/header.liquid", content: "{% %}" },
  ]);
});

test("surfaces read errors from listing theme files", async () => {
  const admin = {
    graphql: async () =>
      graphqlResponse({
        theme: {
          files: {
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
            userErrors: [{ code: "THEME_NOT_FOUND", filename: null }],
          },
        },
      }),
  };

  await assert.rejects(
    listThemeTextFiles(admin, "theme-id"),
    /THEME_NOT_FOUND/,
  );
});

test("getMainTheme returns the published theme name", async () => {
  const { getMainTheme } = await import("./theme-api.server.js");
  const admin = {
    graphql: async () =>
      graphqlResponse({
        themes: {
          nodes: [{ id: "gid://shopify/OnlineStoreTheme/1", name: "Dawn" }],
        },
      }),
  };

  const theme = await getMainTheme(admin);
  assert.equal(theme.name, "Dawn");
});

test("lists every theme with the published theme first", async () => {
  const { getThemes } = await import("./theme-api.server.js");
  const admin = {
    graphql: async () =>
      graphqlResponse({
        themes: {
          nodes: [
            { id: "t2", name: "Venture", role: "UNPUBLISHED" },
            { id: "t1", name: "Dawn", role: "MAIN" },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
  };

  const themes = await getThemes(admin);
  assert.deepEqual(
    themes.map((theme) => theme.id),
    ["t1", "t2"],
  );
});

test("fetches a single theme by id", async () => {
  const { getTheme } = await import("./theme-api.server.js");
  const admin = {
    graphql: async (_query, options) => {
      assert.equal(options.variables.themeId, "t9");
      return graphqlResponse({
        theme: { id: "t9", name: "Draft", role: "UNPUBLISHED" },
      });
    },
  };

  const theme = await getTheme(admin, "t9");
  assert.equal(theme.name, "Draft");
});

test("throws when the theme no longer exists", async () => {
  const { getTheme } = await import("./theme-api.server.js");
  const admin = {
    graphql: async () => graphqlResponse({ theme: null }),
  };

  await assert.rejects(getTheme(admin, "gone"), /no longer exists/);
});
