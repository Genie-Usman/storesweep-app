import { createHash } from "node:crypto";

/** Deterministic content fingerprint used for optimistic-concurrency checks. */
export function contentChecksum(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export default contentChecksum;
