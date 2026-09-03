import test from "node:test";
import assert from "node:assert/strict";

import {
  ignoredFindingKey,
  ignoredFindingRecordKey,
  identifyFindings,
  removeFindings,
} from "./findings.js";
import { contentChecksum } from "./checksum.js";

test("ignore keys hash the exact code so they survive unrelated edits", () => {
  const first = ignoredFindingKey({
    filename: "layout/theme.liquid",
    appName: "Tidio Live Chat",
    matchedCode: '<script src="https://code.tidio.co/key.js"></script>',
  });
  const second = ignoredFindingKey({
    filename: "layout/theme.liquid",
    appName: "Tidio Live Chat",
    matchedCode: '<script src="https://code.tidio.co/key.js"></script>',
  });

  assert.deepEqual(first, second);
  assert.equal(first.codeHash, contentChecksum('<script src="https://code.tidio.co/key.js"></script>'.trim()));
});

test("ignore keys differ per code, app, and file", () => {
  const base = { filename: "a.liquid", appName: "App", matchedCode: "x" };
  const keys = new Set(
    [
      ignoredFindingKey(base),
      ignoredFindingKey({ ...base, matchedCode: "y" }),
      ignoredFindingKey({ ...base, appName: "Other" }),
      ignoredFindingKey({ ...base, filename: "b.liquid" }),
    ].map(ignoredFindingRecordKey),
  );
  assert.equal(keys.size, 4);
});

test("finding IDs remain offset-based for selection", () => {
  const [finding] = identifyFindings([
    { filename: "layout/theme.liquid", startIndex: 3, endIndex: 9, matchedCode: "abc" },
  ]);
  assert.equal(finding.id, "finding:layout/theme.liquid:3-9");
});

test("removal still works alongside ignore helpers", () => {
  assert.equal(removeFindings("xabcz", [{ startIndex: 1, endIndex: 4, matchedCode: "abc" }]), "xz");
});
