export const THEME_WRITE_EXEMPTION_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfZTB1vxFC5d1-GPdqYunWRGUoDcOheHQzfK2RoEFEHrknt5g/viewform";

/** Detect Shopify's protected theme-file write rejection. */
export function isThemeWriteAccessError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalizedMessage = message.toLowerCase();

  return (
    normalizedMessage.includes("themefilesupsert") &&
    (normalizedMessage.includes("access denied") ||
      normalizedMessage.includes("write_themes") ||
      normalizedMessage.includes("exemption"))
  );
}
