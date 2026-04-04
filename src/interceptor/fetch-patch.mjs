/**
 * Patches globalThis.fetch to capture usage metrics from Claude API responses.
 *
 * Strategy: response.clone() — the original response passes through untouched.
 * A cloned copy is drained asynchronously in the background to extract the
 * usage object from SSE events. This avoids the TransformStream approach
 * that broke SSE streaming in budmon-interceptor.
 *
 * This interceptor is READ-ONLY: it never accesses request.body (prompts,
 * code, files). It only reads response headers and the usage object from
 * the cloned response stream.
 */

import { createHash } from "node:crypto";
import { MESSAGES_ENDPOINT, HEADERS } from "../constants.mjs";
import { drainUsageFromClone } from "./usage-extractor.mjs";
import { buildRow, appendRow } from "../log/writer.mjs";

let _origFetch = null;
let _sessionHash = null;

function getSessionHash() {
  if (!_sessionHash) {
    // Generate a stable-ish session identifier from process start time.
    // Truncated hash — not identifying, just groups rows from the same process.
    const seed = `${process.pid}-${Date.now()}`;
    _sessionHash = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  }
  return _sessionHash;
}

/**
 * Extract rate-limit headers from the response.
 * Returns an object with parsed numeric values.
 */
function extractHeaders(response) {
  return {
    q5h: parseFloat(response.headers.get(HEADERS.Q5H)) || 0,
    q7d: parseFloat(response.headers.get(HEADERS.Q7D)) || 0,
    q5h_reset: parseInt(response.headers.get(HEADERS.Q5H_RESET)) || 0,
    q7d_reset: parseInt(response.headers.get(HEADERS.Q7D_RESET)) || 0,
    qstatus: response.headers.get(HEADERS.STATUS) || "",
    qoverage: response.headers.get(HEADERS.OVERAGE) || "",
    qclaim: response.headers.get(HEADERS.CLAIM) || "",
    qfallback_pct: parseFloat(response.headers.get(HEADERS.FALLBACK_PCT)) || 0,
  };
}

/**
 * Install the fetch patch. Call once at import time.
 */
export function installFetchPatch() {
  if (_origFetch) return; // Already installed
  _origFetch = globalThis.fetch;

  globalThis.fetch = async function (url, options) {
    const urlStr = typeof url === "string" ? url : url?.toString?.() || "";
    const isMessagesEndpoint = urlStr.includes(MESSAGES_ENDPOINT);

    // Call the original (or chained) fetch
    const response = await _origFetch.apply(this, [url, options]);

    if (!isMessagesEndpoint) return response;

    // Extract headers synchronously (no body access needed)
    let headers;
    try {
      headers = extractHeaders(response);
    } catch {
      return response;
    }

    // Clone for async usage extraction — original passes through untouched
    try {
      const clone = response.clone();
      drainUsageFromClone(clone)
        .then((usage) => {
          if (!usage) return;
          const row = buildRow(usage, headers, getSessionHash());
          if (row) appendRow(row);
        })
        .catch(() => {});
    } catch {
      // clone() failure is non-fatal
    }

    return response;
  };
}
