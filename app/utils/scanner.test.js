import test from "node:test";
import assert from "node:assert/strict";

import { scanThemeLiquid } from "./scanner.js";

test("finds a known script and reports one-based line ranges", () => {
  const theme = [
    "<html>",
    "  <head>",
    '    <script async src="https://code.tidio.co/store-key.js"></script>',
    "  </head>",
    "</html>",
  ].join("\n");
  const [finding] = scanThemeLiquid(theme);

  assert.equal(finding.appName, "Tidio Chat");
  assert.equal(finding.lineNumbers.start, 3);
  assert.equal(finding.lineNumbers.end, 3);
});

test("finds multiline named comment blocks and uses their label", () => {
  const theme = [
    "before",
    "<!-- Begin Old Wishlist -->",
    '<script src="https://example.test/old.js"></script>',
    "<!-- End Old Wishlist -->",
    "after",
  ].join("\n");
  const [finding] = scanThemeLiquid(theme);

  assert.equal(finding.appName, "Old Wishlist");
  assert.deepEqual(finding.lineNumbers, { start: 2, end: 4 });
  assert.match(finding.matchedCode, /example\.test\/old\.js/);
});

test("returns every occurrence without retaining RegExp state", () => {
  const snippet = "{% render 'judgeme_widgets' %}";
  const theme = `${snippet}\n${snippet}`;

  assert.equal(scanThemeLiquid(theme).length, 2);
  assert.equal(scanThemeLiquid(theme).length, 2);
});

test("rejects non-string input", () => {
  assert.throws(() => scanThemeLiquid(null), /must be a string/);
});
