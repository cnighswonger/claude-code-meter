import { appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { LOG_FILE, SCHEMA_VERSION } from "../constants.mjs";
import { MeterRowSchema } from "./schema.mjs";

let _lastQ5h = null;
let _lastQ7d = null;

/**
 * Build and validate a JSONL row from raw usage + header data.
 * Returns the validated row object, or null if validation fails.
 */
export function buildRow(usage, headers, sessionHash) {
  const totalIn =
    (usage.input_tokens || 0) +
    (usage.cache_creation_input_tokens || 0) +
    (usage.cache_read_input_tokens || 0);

  const cacheHitRate =
    totalIn > 0 ? (usage.cache_read_input_tokens || 0) / totalIn : 0;

  const q5h = headers.q5h ?? 0;
  const q7d = headers.q7d ?? 0;
  const q5hDelta = _lastQ5h !== null ? q5h - _lastQ5h : 0;
  const q7dDelta = _lastQ7d !== null ? q7d - _lastQ7d : 0;
  _lastQ5h = q5h;
  _lastQ7d = q7d;

  const cacheCreation = usage.cache_creation || {};

  const row = {
    v: SCHEMA_VERSION,
    ts: new Date().toISOString(),
    sid: sessionHash,

    model: usage._model || "",
    requested_model: usage._requested_model || "",
    model_mismatch: !!(usage._requested_model && usage._model && usage._requested_model !== usage._model),
    speed: usage.speed || "",
    service_tier: usage.service_tier || "",

    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
    cache_read_input_tokens: usage.cache_read_input_tokens || 0,
    ephemeral_1h_input_tokens: cacheCreation.ephemeral_1h_input_tokens || 0,
    ephemeral_5m_input_tokens: cacheCreation.ephemeral_5m_input_tokens || 0,
    web_search_requests: usage.server_tool_use?.web_search_requests || 0,

    q5h,
    q7d,
    q5h_reset: headers.q5h_reset || 0,
    q7d_reset: headers.q7d_reset || 0,
    qstatus: headers.qstatus || "",
    qoverage: headers.qoverage || "",
    qclaim: headers.qclaim || "",
    qfallback_pct: headers.qfallback_pct || 0,
    ...(headers.qoverage_util != null && { qoverage_util: headers.qoverage_util }),
    ...(headers.qrepresentative_claim && { qrepresentative_claim: headers.qrepresentative_claim }),
    ...(headers.org_id && { org_id: createHash("sha256").update(headers.org_id).digest("hex").slice(0, 16) }),
    ...(headers.overage_disabled_reason && { overage_disabled_reason: headers.overage_disabled_reason }),

    cache_hit_rate: cacheHitRate,
    q5h_delta: q5hDelta,
    q7d_delta: q7dDelta,
  };

  const result = MeterRowSchema.safeParse(row);
  if (!result.success) {
    return null;
  }
  return result.data;
}

/**
 * Append a validated row to the JSONL log file.
 */
export function appendRow(row) {
  try {
    appendFileSync(LOG_FILE, JSON.stringify(row) + "\n", "utf-8");
  } catch {
    // Fail-open: never break the API call
  }
}
