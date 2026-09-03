import { rateLimiter } from "./rate-limit.server.js";

export const NO_STORE_HEADERS = { "Cache-Control": "private, no-store" };

/** Theme mutations need full theme fetches; cap request bodies tightly. */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

export function jsonResponse(body, status = 200) {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

export function errorResponse(error, status = 400, extra = {}) {
  return jsonResponse({ success: false, error, ...extra }, status);
}

/**
 * Returns a 429 response when the shop exceeded its allowance for this
 * action, or null when the request may proceed.
 */
export function enforceRateLimit(action, shop) {
  const result = rateLimiter.take(action, shop);

  if (result.allowed) return null;

  return jsonResponse(
    {
      success: false,
      error: `Too many ${action} requests. Try again in ${result.retryAfterSeconds} seconds.`,
      code: "RATE_LIMITED",
    },
    429,
  );
}

/** Parse a JSON request body under a hard size ceiling. */
export async function readJsonBody(request) {
  const declaredLength = Number(request.headers.get("content-length") || "0");
  if (declaredLength > MAX_JSON_BODY_BYTES) {
    return { error: "The request body is too large." };
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return { error: "The request body must be valid JSON." };
  }

  if (JSON.stringify(body).length > MAX_JSON_BODY_BYTES) {
    return { error: "The request body is too large." };
  }

  return { body };
}
