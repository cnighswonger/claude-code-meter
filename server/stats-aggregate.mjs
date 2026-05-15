/**
 * Aggregate /api/v1/stats response across both submission types:
 *   - SharePayloadSchema rows (per-session aggregate): top-level `model`,
 *     `turn_count`, `date`. One row = one session of one model.
 *   - Analysis rows (`type: "analysis"`): nested `model_splits` (object keyed
 *     by model name with per-model `n_calls`), `n_calls`, `n_sessions`,
 *     `generated_at`.
 *
 * Pure function — kept in its own module so unit tests don't pull in the
 * full server (which auto-starts an HTTP listener on import).
 *
 * Returns:
 *   {
 *     total_submissions, submissions_by_type: { share, analysis },
 *     total_calls, total_turns (back-compat alias for total_calls),
 *     total_sessions, models (CALL counts per model name),
 *     earliest, latest
 *   }
 *
 * Prior to 2026-04-26 the endpoint assumed SharePayloadSchema shape and
 * returned `total_turns: 0` and `models: { undefined: N }` for analysis
 * submissions. This function detects the shape per row and aggregates
 * correctly across mixed-type datasets.
 *
 * Analysis rows are deduped by `install_id` before aggregation — see
 * `dedupAnalysisByInstallId`. Share rows are intentionally not deduped.
 * `total_submissions` and `submissions_by_type` continue to reflect the
 * raw row counts; only the call / session / model totals change.
 */
export function computeStatsAggregate(rows) {
  // Count raw submissions by type before dedup so the reported breakdown
  // matches the row count downstream consumers see at /api/v1/dataset.
  let shareSubmissions = 0;
  let analysisSubmissions = 0;
  for (const r of rows) {
    if (r && r.type === "analysis") analysisSubmissions++;
    else if (r) shareSubmissions++;
  }

  const deduped = dedupAnalysisByInstallId(rows);
  const models = new Map();
  let totalCalls = 0;
  let totalSessions = 0;
  const dates = [];

  for (const r of deduped) {
    if (r && r.type === "analysis") {
      totalCalls += Number.isFinite(r.n_calls) ? r.n_calls : 0;
      totalSessions += Number.isFinite(r.n_sessions) ? r.n_sessions : 0;
      if (r.model_splits && typeof r.model_splits === "object") {
        for (const [modelName, modelData] of Object.entries(r.model_splits)) {
          const calls = (modelData && typeof modelData === "object" && Number.isFinite(modelData.n_calls))
            ? modelData.n_calls
            : 0;
          models.set(modelName, (models.get(modelName) || 0) + calls);
        }
      }
      if (r.generated_at) dates.push(r.generated_at);
      else if (r.data_range && r.data_range.end) dates.push(r.data_range.end);
    } else if (r) {
      // Default: treat as SharePayloadSchema (legacy rows have no `type`).
      const turns = Number.isFinite(r.turn_count) ? r.turn_count : 0;
      totalCalls += turns;
      totalSessions += 1; // share submission = one session
      if (r.model) {
        models.set(r.model, (models.get(r.model) || 0) + turns);
      }
      if (r.date) dates.push(r.date);
    }
  }

  dates.sort();

  return {
    total_submissions: rows.length,
    submissions_by_type: { share: shareSubmissions, analysis: analysisSubmissions },
    total_calls: totalCalls,
    total_turns: totalCalls, // back-compat alias
    total_sessions: totalSessions,
    models: Object.fromEntries(models), // CALL counts per model, not submission counts
    earliest: dates.length > 0 ? dates[0] : null,
    latest: dates.length > 0 ? dates[dates.length - 1] : null,
  };
}

/**
 * Keep only the newest analysis snapshot per `install_id`. Share rows,
 * analysis rows without an `install_id`, and null/undefined rows pass
 * through untouched.
 *
 * Each `type: "analysis"` submission is a CUMULATIVE snapshot covering the
 * install's full data range, so two snapshots from the same install have
 * overlapping windows. Summing them inflates totals — the latest snapshot
 * supersedes earlier ones.
 *
 * Newest is selected by `generated_at`, falling back to `data_range.end`
 * if `generated_at` is missing. ISO-8601 timestamps compare correctly as
 * strings, so no Date parsing is needed.
 *
 * Share / SharePayloadSchema rows are NOT deduped — they are per-session
 * aggregates with non-overlapping windows, so summing them is correct.
 */
export function dedupAnalysisByInstallId(rows) {
  const latestByInstall = new Map();
  const passthrough = [];

  for (const r of rows) {
    if (!r || r.type !== "analysis" || !r.install_id) {
      passthrough.push(r);
      continue;
    }
    const key = r.install_id;
    const ts = r.generated_at || (r.data_range && r.data_range.end) || "";
    const existing = latestByInstall.get(key);
    const existingTs = existing
      ? (existing.generated_at || (existing.data_range && existing.data_range.end) || "")
      : "";
    if (!existing || ts > existingTs) {
      latestByInstall.set(key, r);
    }
  }

  return [...passthrough, ...latestByInstall.values()];
}
