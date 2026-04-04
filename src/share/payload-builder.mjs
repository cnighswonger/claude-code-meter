import { readAllRows, filterBySession, groupBySession } from "../log/reader.mjs";
import { SharePayloadSchema } from "../log/schema.mjs";

/**
 * Build a community share payload from local JSONL data for a given session.
 * Aggregates per-turn data into a single session summary.
 * Returns { payload, valid, errors }.
 */
export function buildSharePayload(sid, planTier = "unknown") {
  const rows = readAllRows();
  const sessions = groupBySession(rows);

  let sessionRows;
  if (sid) {
    sessionRows = sessions.get(sid);
  } else {
    // Most recent session
    let latestTs = "";
    for (const [s, sRows] of sessions) {
      const last = sRows[sRows.length - 1].ts;
      if (last > latestTs) {
        latestTs = last;
        sid = s;
        sessionRows = sRows;
      }
    }
  }

  if (!sessionRows || sessionRows.length === 0) {
    return { payload: null, valid: false, errors: ["No data for session"] };
  }

  // Determine primary model and speed
  const modelCounts = new Map();
  const speeds = new Set();
  for (const r of sessionRows) {
    modelCounts.set(r.model, (modelCounts.get(r.model) || 0) + 1);
    if (r.speed) speeds.add(r.speed);
  }
  let primaryModel = "";
  let maxCount = 0;
  for (const [m, c] of modelCounts) {
    if (c > maxCount) { primaryModel = m; maxCount = c; }
  }

  let speed = "standard";
  if (speeds.has("standard") && speeds.has("fast")) speed = "mixed";
  else if (speeds.has("fast")) speed = "fast";

  // Aggregate tokens
  let totalInput = 0, totalOutput = 0, totalCacheCreate = 0, totalCacheRead = 0;
  let totalEph1h = 0, totalEph5m = 0, totalWebSearch = 0;
  let cacheHitSum = 0;

  for (const r of sessionRows) {
    totalInput += r.input_tokens;
    totalOutput += r.output_tokens;
    totalCacheCreate += r.cache_creation_input_tokens;
    totalCacheRead += r.cache_read_input_tokens;
    totalEph1h += r.ephemeral_1h_input_tokens;
    totalEph5m += r.ephemeral_5m_input_tokens;
    totalWebSearch += r.web_search_requests;
    cacheHitSum += r.cache_hit_rate;
  }

  const first = sessionRows[0];
  const last = sessionRows[sessionRows.length - 1];

  const payload = {
    v: 1,
    date: first.ts.slice(0, 10),
    model: primaryModel,
    speed,
    turn_count: sessionRows.length,
    plan_tier: planTier,

    total_input_tokens: totalInput,
    total_output_tokens: totalOutput,
    total_cache_creation_tokens: totalCacheCreate,
    total_cache_read_tokens: totalCacheRead,
    total_ephemeral_1h_tokens: totalEph1h,
    total_ephemeral_5m_tokens: totalEph5m,
    total_web_search_requests: totalWebSearch,

    avg_cache_hit_rate: sessionRows.length > 0 ? cacheHitSum / sessionRows.length : 0,

    q5h_start: first.q5h,
    q5h_end: last.q5h,
    q7d_start: first.q7d,
    q7d_end: last.q7d,
    q5h_total_delta: last.q5h - first.q5h,
    q7d_total_delta: last.q7d - first.q7d,
  };

  const result = SharePayloadSchema.safeParse(payload);
  if (!result.success) {
    return {
      payload,
      valid: false,
      errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }

  return { payload: result.data, valid: true, errors: [] };
}
