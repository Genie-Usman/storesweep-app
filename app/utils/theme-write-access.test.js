import test from "node:test";
import assert from "node:assert/strict";

import {
  isThemeWriteAccessError,
  THEME_WRITE_EXEMPTION_URL,
} from "./theme-write-access.js";

test("recognizes Shopify's themeFilesUpsert exemption error", () => {
  const error = new Error(
    "Access denied for themeFilesUpsert field. Required access: " +
      "The user needs write_themes and an exemption from Shopify.",
  );

  assert.equal(isThemeWriteAccessError(error), true);
});

test("does not classify unrelated API failures as exemption errors", () => {
  assert.equal(isThemeWriteAccessError(new Error("Theme changed")), false);
});

test("provides Shopify's protected-scope request form", () => {
  assert.match(THEME_WRITE_EXEMPTION_URL, /^https:\/\/docs\.google\.com\/forms\//);
});
