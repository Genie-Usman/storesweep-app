import { contentChecksum } from "./checksum.js";

/** Add stable IDs to scanner findings so the client can select exact matches. */
export function findingKey(finding) {
  const prefix = finding.filename
    ? `finding:${finding.filename}:${finding.startIndex}-${finding.endIndex}`
    : `finding-${finding.startIndex}-${finding.endIndex}`;
  return prefix;
}

export function identifyFindings(findings) {
  return findings.map((finding) => ({
    ...finding,
    id: findingKey(finding),
  }));
}

/**
 * Stable ignore identity for a finding: the exact code, not its offsets.
 * Hashing keeps an ignored match ignored across unrelated edits elsewhere
 * in the same file.
 */
export function ignoredFindingKey({ filename, appName, matchedCode }) {
  return {
    filename,
    appName,
    codeHash: contentChecksum(matchedCode.trim()),
  };
}

/** Flat form of an ignore identity for Set lookups. */
export function ignoredFindingRecordKey({ filename, appName, codeHash }) {
  return `${filename}|${appName}|${codeHash}`;
}

/**
 * Remove only the exact source ranges represented by selected scanner results.
 * Overlapping ranges are merged so nested signatures cannot corrupt the file.
 */
export function removeFindings(source, findings) {
  if (typeof source !== "string") {
    throw new TypeError("Theme source must be a string.");
  }

  if (!Array.isArray(findings) || findings.length === 0) return source;

  const ranges = findings
    .map((finding) => {
      const { startIndex, endIndex, matchedCode } = finding;

      if (
        !Number.isInteger(startIndex) ||
        !Number.isInteger(endIndex) ||
        startIndex < 0 ||
        endIndex <= startIndex ||
        endIndex > source.length ||
        source.slice(startIndex, endIndex) !== matchedCode
      ) {
        throw new Error("A selected finding no longer matches the theme source.");
      }

      return { start: startIndex, end: endIndex };
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const mergedRanges = [];
  for (const range of ranges) {
    const previous = mergedRanges.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      mergedRanges.push({ ...range });
    }
  }

  let cursor = 0;
  let cleanedSource = "";
  for (const range of mergedRanges) {
    cleanedSource += source.slice(cursor, range.start);
    cursor = range.end;
  }

  return cleanedSource + source.slice(cursor);
}
