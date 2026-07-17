import test from "node:test";
import assert from "node:assert/strict";

import { getThemeLiquid } from "./theme-api.server.js";

test("queries the read-error fields supported by Shopify's theme schema", async () => {
  const admin = {
    graphql: async (query) => {
      const readErrorSelection = query.match(/userErrors\s*{([^}]*)}/)?.[1];

      assert.match(readErrorSelection, /code/);
      assert.match(readErrorSelection, /filename/);
      assert.doesNotMatch(readErrorSelection, /message/);

      return {
        json: async () => ({
          data: {
            theme: {
              files: {
                nodes: [],
                userErrors: [
                  { code: "NOT_FOUND", filename: "layout/theme.liquid" },
                ],
              },
            },
          },
        }),
      };
    },
  };

  await assert.rejects(
    getThemeLiquid(admin, "theme-id"),
    /layout\/theme\.liquid: NOT_FOUND/,
  );
});
