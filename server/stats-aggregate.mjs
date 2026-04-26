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
 */
export function computeStatsAggregate(rows) {
  const models = new Map();
  let totalCalls = 0;
  let totalSessions = 0;
  let shareSubmissions = 0;
  let analysisSubmissions = 0;
  const dates = [];

  for (const r of rows) {
    if (r && r.type === "analysis") {
      analysisSubmissions++;
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
      shareSubmissions++;
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
