import test from "node:test";
import assert from "node:assert/strict";

import { identifyFindings, removeFindings } from "./findings.js";

test("adds deterministic finding IDs", () => {
  const [finding] = identifyFindings([{ startIndex: 5, endIndex: 10 }]);
  assert.equal(finding.id, "finding-5-10");
});

test("scopes IDs to their file when a filename is present", () => {
  const [finding] = identifyFindings([
    { filename: "layout/theme.liquid", startIndex: 5, endIndex: 10 },
  ]);
  assert.equal(finding.id, "finding:layout/theme.liquid:5-10");
});

test("removes exact findings and preserves surrounding source", () => {
  const source = "before<remove>middle<also-remove>after";
  const findings = [
    {
      startIndex: 6,
      endIndex: 14,
      matchedCode: "<remove>",
    },
    {
      startIndex: 20,
      endIndex: 33,
      matchedCode: "<also-remove>",
    },
  ];

  assert.equal(removeFindings(source, findings), "beforemiddleafter");
});

test("merges overlapping selected ranges", () => {
  const source = "0123456789";
  const findings = [
    { startIndex: 2, endIndex: 8, matchedCode: "234567" },
    { startIndex: 4, endIndex: 6, matchedCode: "45" },
  ];

  assert.equal(removeFindings(source, findings), "0189");
});

test("rejects stale or tampered ranges", () => {
  assert.throws(
    () =>
      removeFindings("original", [
        { startIndex: 0, endIndex: 8, matchedCode: "tampered" },
      ]),
    /no longer matches/,
  );
});
