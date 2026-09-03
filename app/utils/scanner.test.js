import test from "node:test";
import assert from "node:assert/strict";

import { CATEGORY, scanThemeFile, scanThemeLiquid } from "./scanner.js";

test("finds a known script and reports one-based line ranges", () => {
  const theme = [
    "<html>",
    "  <head>",
    '    <script async src="https://code.tidio.co/store-key.js"></script>',
    "  </head>",
    "</html>",
  ].join("\n");
  const [finding] = scanThemeFile(theme);

  assert.equal(finding.appName, "Tidio Live Chat");
  assert.equal(finding.category, CATEGORY.SUPPORT);
  assert.equal(finding.confidence, "high");
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
  const [finding] = scanThemeFile(theme);

  assert.equal(finding.appName, "Old Wishlist");
  assert.equal(finding.category, CATEGORY.UNKNOWN);
  assert.deepEqual(finding.lineNumbers, { start: 2, end: 4 });
  assert.match(finding.matchedCode, /example\.test\/old\.js/);
});

test("returns every occurrence without retaining RegExp state", () => {
  const snippet = "{% render 'judgeme_widgets' %}";
  const theme = `${snippet}\n${snippet}`;

  assert.equal(scanThemeFile(theme).length, 2);
  assert.equal(scanThemeFile(theme).length, 2);
});

test("detects snippet renders for major review apps", () => {
  const theme = [
    "{% render 'jdgm_product_widget' %}",
    "{% render 'loox-inline' %}",
    "{% include 'okendo-reviews' %}",
  ].join("\n");

  const appNames = scanThemeFile(theme).map((finding) => finding.appName);
  assert.deepEqual(appNames, [
    "Judge.me Product Reviews",
    "Loox Product Reviews",
    "Okendo Reviews",
  ]);
});

test("detects Klaviyo analytics and marketing scripts", () => {
  const theme =
    '<script src="https://static.klaviyo.com/onsite/js/klaviyo.js"></script>';
  const [finding] = scanThemeFile(theme);

  assert.equal(finding.appName, "Klaviyo Email & SMS");
  assert.equal(finding.category, CATEGORY.MARKETING);
});

test("flags generic analytics with lower confidence", () => {
  const theme =
    '<script async src="https://www.google-analytics.com/analytics.js"></script>';
  const [finding] = scanThemeFile(theme);

  assert.equal(finding.appName, "Google Analytics");
  assert.equal(finding.confidence, "low");
});

test("scans JSON templates without crashing", () => {
  const template = JSON.stringify({
    sections: { reviews: { type: "judgeme_section" } },
  });

  assert.equal(scanThemeFile(template).length, 0);
});

test("rejects non-string input", () => {
  assert.throws(() => scanThemeFile(null), /must be a string/);
});

test("keeps the legacy single-file alias working", () => {
  assert.equal(scanThemeLiquid, scanThemeFile);
});
