/**
 * A match means "review this code", not "this app is uninstalled".
 * Expressions are global because one theme can contain multiple leftovers.
 */
export const KNOWN_APP_SIGNATURES = Object.freeze([
  {
    appName: "Tidio Chat",
    pattern:
      /<script\b[^>]*\bsrc=["'][^"']*code\.tidio\.co\/[^"']+["'][^>]*>\s*<\/script\s*>/gi,
  },
  {
    appName: "Judge.me Reviews",
    pattern:
      /(?:<script\b[^>]*\bsrc=["'][^"']*(?:cdn\.judge\.me|judgeme)[^"']*["'][^>]*>\s*<\/script\s*>|{%-?\s*(?:render|include)\s+["']judgeme[^"']*["'][^%]*-?%})/gi,
  },
  {
    appName: "Loox Reviews",
    pattern:
      /(?:<script\b[^>]*\bsrc=["'][^"']*(?:loox\.io|looxcdn\.com)[^"']*["'][^>]*>\s*<\/script\s*>|{%-?\s*(?:render|include)\s+["']loox[^"']*["'][^%]*-?%})/gi,
  },
  {
    appName: "Reamaze Chat",
    pattern:
      /<script\b[^>]*\bsrc=["'][^"']*(?:reamaze\.com|reamaze\.io)[^"']*["'][^>]*>\s*<\/script\s*>/gi,
  },
  {
    appName: "Named app block",
    pattern:
      /<!--\s*Begin\s+([^<>\r\n]+?)\s*-->[\s\S]*?<!--\s*End\s+\1\s*-->/gi,
    getAppName: (match) => match[1].trim(),
  },
]);

function lineAtOffset(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

/**
 * Scan raw layout/theme.liquid text for known third-party signatures.
 * Character offsets are included so later removal can be deterministic.
 */
export function scanThemeLiquid(themeLiquid) {
  if (typeof themeLiquid !== "string") {
    throw new TypeError("themeLiquid must be a string.");
  }

  const findings = [];

  for (const signature of KNOWN_APP_SIGNATURES) {
    const flags = signature.pattern.flags.includes("g")
      ? signature.pattern.flags
      : `${signature.pattern.flags}g`;
    const pattern = new RegExp(signature.pattern.source, flags);

    for (const match of themeLiquid.matchAll(pattern)) {
      const matchedCode = match[0];
      const startIndex = match.index;
      const endIndex = startIndex + matchedCode.length;

      findings.push({
        appName: signature.getAppName?.(match) || signature.appName,
        matchedCode,
        lineNumbers: {
          start: lineAtOffset(themeLiquid, startIndex),
          end: lineAtOffset(themeLiquid, Math.max(startIndex, endIndex - 1)),
        },
        startIndex,
        endIndex,
      });
    }
  }

  return findings.sort(
    (left, right) =>
      left.startIndex - right.startIndex || right.endIndex - left.endIndex,
  );
}

export default scanThemeLiquid;
