/**
 * A match means "review this code", not "this app is uninstalled".
 * Expressions are global because one theme can contain multiple leftovers.
 *
 * confidence:
 *   high   - dedicated app CDN/domain, virtually never hand-written
 *   medium - vendor script tag, occasionally part of a marketing stack a
 *            merchant still uses
 *   low    - generic tag that is very often intentional; surface for
 *            review but keep the copy tone cautious
 */
export const CATEGORY = Object.freeze({
  REVIEWS: "reviews",
  ANALYTICS: "analytics",
  MARKETING: "marketing",
  SUPPORT: "support",
  PERSONALIZATION: "personalization",
  SUBSCRIPTIONS: "subscriptions",
  UTILITY: "utility",
  UNKNOWN: "unknown",
});

const scriptTag = (hostPattern) =>
  `<script\\b[^>]*\\bsrc=["'][^"']*(?:${hostPattern})[^"']*["'][^>]*>\\s*</script\\s*>`;

const renderSnippet = (namePattern) =>
  `{%-?\\s*(?:render|include|section)\\s+["']${namePattern}[^"']*["'][^%]*-?%}`;

function signature(appName, category, confidence, pattern) {
  return Object.freeze({ appName, category, confidence, pattern });
}

export const KNOWN_APP_SIGNATURES = [
  signature(
    "Judge.me Product Reviews",
    CATEGORY.REVIEWS,
    "high",
    new RegExp(
      `(?:${scriptTag("cdn\\.judge\\.me|judgeme")}|${renderSnippet("jdgm|judgeme")})`,
      "gi",
    ),
  ),
  signature(
    "Loox Product Reviews",
    CATEGORY.REVIEWS,
    "high",
    new RegExp(
      `(?:${scriptTag("loox\\.io|looxcdn\\.com")}|${renderSnippet("loox")})`,
      "gi",
    ),
  ),
  signature(
    "Yotpo Product Reviews",
    CATEGORY.REVIEWS,
    "high",
    new RegExp(
      `(?:${scriptTag("staticw2\\.yotpo\\.com|yotpo\\.com")}|${renderSnippet("yotpo")})`,
      "gi",
    ),
  ),
  signature(
    "Stamped.io Reviews & Loyalty",
    CATEGORY.REVIEWS,
    "high",
    new RegExp(
      `(?:${scriptTag("cdn1?\\.stamped\\.io|stamped\\.io")}|${renderSnippet("stamped")})`,
      "gi",
    ),
  ),
  signature(
    "Okendo Reviews",
    CATEGORY.REVIEWS,
    "high",
    new RegExp(
      `(?:${scriptTag("cdn\\.okendo\\.io|okendo\\.io")}|${renderSnippet("okendo")})`,
      "gi",
    ),
  ),
  signature(
    "Fera Product Reviews",
    CATEGORY.REVIEWS,
    "high",
    new RegExp(
      `(?:${scriptTag("cdn\\.fera\\.ai|fera\\.ai")}|${renderSnippet("fera")})`,
      "gi",
    ),
  ),
  signature(
    "Tidio Live Chat",
    CATEGORY.SUPPORT,
    "high",
    new RegExp(scriptTag("code\\.tidio\\.co|tidio\\.co"), "gi"),
  ),
  signature(
    "Reamaze Chat",
    CATEGORY.SUPPORT,
    "high",
    new RegExp(scriptTag("reamaze\\.com|reamaze\\.io"), "gi"),
  ),
  signature(
    "Gorgias Helpdesk",
    CATEGORY.SUPPORT,
    "high",
    new RegExp(scriptTag("gorgias"), "gi"),
  ),
  signature(
    "Zendesk / Zopim Chat",
    CATEGORY.SUPPORT,
    "high",
    new RegExp(scriptTag("zdassets\\.com|zopim\\.com|zendesk"), "gi"),
  ),
  signature(
    "Klaviyo Email & SMS",
    CATEGORY.MARKETING,
    "high",
    new RegExp(
      `(?:${scriptTag("klaviyo\\.com|klaviyo")}|${renderSnippet("klaviyo")})`,
      "gi",
    ),
  ),
  signature(
    "Omnisend Email Marketing",
    CATEGORY.MARKETING,
    "high",
    new RegExp(
      `(?:${scriptTag("omnisend\\.com")}|${renderSnippet("omnisend")})`,
      "gi",
    ),
  ),
  signature(
    "Mailchimp",
    CATEGORY.MARKETING,
    "high",
    new RegExp(scriptTag("chimpstatic\\.com|list-manage\\.com|mailchimp"), "gi"),
  ),
  signature(
    "Privy Email & Pop-ups",
    CATEGORY.MARKETING,
    "high",
    new RegExp(scriptTag("widget\\.privy\\.com|privy\\.com"), "gi"),
  ),
  signature(
    "Smile.io Loyalty",
    CATEGORY.PERSONALIZATION,
    "high",
    new RegExp(scriptTag("smile\\.io"), "gi"),
  ),
  signature(
    "Rebuy Personalization",
    CATEGORY.PERSONALIZATION,
    "high",
    new RegExp(scriptTag("rebuyengine\\.com|rebuy"), "gi"),
  ),
  signature(
    "ReCharge Subscriptions",
    CATEGORY.SUBSCRIPTIONS,
    "medium",
    new RegExp(
      `(?:${scriptTag("rechargeassets\\.com|rechargepayments")}|${renderSnippet("rc-")})`,
      "gi",
    ),
  ),
  signature(
    "Vitals: 40+ Marketing Apps",
    CATEGORY.UTILITY,
    "high",
    new RegExp(scriptTag("vitals\\.co"), "gi"),
  ),
  signature(
    "Zipify One-Click Upsell",
    CATEGORY.UTILITY,
    "high",
    new RegExp(scriptTag("zipify"), "gi"),
  ),
  signature(
    "TikTok Pixel",
    CATEGORY.ANALYTICS,
    "medium",
    new RegExp(scriptTag("analytics\\.tiktok\\.com"), "gi"),
  ),
  signature(
    "Meta (Facebook) Pixel",
    CATEGORY.ANALYTICS,
    "medium",
    new RegExp(scriptTag("connect\\.facebook\\.net"), "gi"),
  ),
  signature(
    "Pinterest Tag",
    CATEGORY.ANALYTICS,
    "medium",
    new RegExp(scriptTag("ct\\.pinterest\\.com"), "gi"),
  ),
  signature(
    "Snapchat Pixel",
    CATEGORY.ANALYTICS,
    "medium",
    new RegExp(scriptTag("sc-static\\.net|snapchat"), "gi"),
  ),
  signature(
    "Hotjar Heatmaps",
    CATEGORY.ANALYTICS,
    "high",
    new RegExp(scriptTag("static\\.hotjar\\.com|hotjar"), "gi"),
  ),
  signature(
    "Lucky Orange Heatmaps",
    CATEGORY.ANALYTICS,
    "high",
    new RegExp(scriptTag("luckyorange"), "gi"),
  ),
  signature(
    "Microsoft Clarity",
    CATEGORY.ANALYTICS,
    "medium",
    new RegExp(scriptTag("clarity\\.ms"), "gi"),
  ),
  signature(
    "Google Tag Manager",
    CATEGORY.ANALYTICS,
    "medium",
    new RegExp(scriptTag("googletagmanager\\.com"), "gi"),
  ),
  signature(
    "Google Analytics",
    CATEGORY.ANALYTICS,
    "low",
    new RegExp(scriptTag("google-analytics\\.com"), "gi"),
  ),
];

// Named blocks derive their label from the match itself.
KNOWN_APP_SIGNATURES.push(
  Object.freeze({
    appName: "Named app block",
    category: CATEGORY.UNKNOWN,
    confidence: "medium",
    pattern: /<!--\s*Begin\s+([^<>\r\n]+?)\s*-->[\s\S]*?<!--\s*End\s+\1\s*-->/gi,
    getAppName: (match) => match[1].trim(),
  }),
);

Object.freeze(KNOWN_APP_SIGNATURES);

function lineAtOffset(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

/**
 * Scan one theme file's raw text for known third-party signatures.
 * Character offsets are included so later removal can be deterministic.
 */
export function scanThemeFile(themeSource) {
  if (typeof themeSource !== "string") {
    throw new TypeError("themeSource must be a string.");
  }

  const findings = [];

  for (const item of KNOWN_APP_SIGNATURES) {
    const flags = item.pattern.flags.includes("g")
      ? item.pattern.flags
      : `${item.pattern.flags}g`;
    const pattern = new RegExp(item.pattern.source, flags);

    for (const match of themeSource.matchAll(pattern)) {
      const matchedCode = match[0];
      const startIndex = match.index;
      const endIndex = startIndex + matchedCode.length;

      findings.push({
        appName: item.getAppName?.(match) || item.appName,
        category: item.category,
        confidence: item.confidence,
        matchedCode,
        lineNumbers: {
          start: lineAtOffset(themeSource, startIndex),
          end: lineAtOffset(themeSource, Math.max(startIndex, endIndex - 1)),
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

/** Backwards-compatible alias for the single-file MVP scanner. */
export const scanThemeLiquid = scanThemeFile;

export default scanThemeFile;
