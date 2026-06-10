// Shared accessor for per-model metrics. Three+ chart components consume
// this; lives in web/src/lib/ per the directive's rule on shared helpers
// (no new abstraction unless 2+ components consume it; otherwise inline).
//
// See docs/directives/dashboard-dynamic-models.md for the full design.

/**
 * Read a per-model value from the metrics object.
 *
 * @param {object} metrics       - The metrics object derived in web/src/lib/derive.js
 * @param {string} modelKey      - A KNOWN_RATES key, e.g. "claude-opus-4-7"
 * @param {string} field         - One of "modelCostPerTurn" | "avg_q5h_per_turn"
 * @returns {number}             - The value, or 0 when absent
 *
 * For "avg_q5h_per_turn" the lookup goes through metrics.modelSplits[modelKey].
 * For other fields the lookup goes through metrics[field][modelKey].
 */
export function getModelMetric(metrics, modelKey, field) {
  if (field === "avg_q5h_per_turn") {
    return metrics.modelSplits?.[modelKey]?.avg_q5h_per_turn || 0;
  }
  return metrics[field]?.[modelKey] || 0;
}

/**
 * Shorten a model key for display in chart axis labels / annotations.
 * Strips the leading "claude-" prefix. Used by both data-lookup sites
 * and user-visible-label sites that derive from MODEL_BASELINE or
 * EDITORIAL_COMPARISON_PAIR.
 *
 * Centralized here so all 4 chart components share one definition
 * (was duplicated in charts.jsx pre-refactor).
 *
 * @param {string} m - Model key
 * @returns {string}
 */
export function shortenModel(m) {
  return m.replace(/^claude-/, "");
}
