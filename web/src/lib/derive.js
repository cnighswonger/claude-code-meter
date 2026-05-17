// web/src/lib/derive.js
//
// Derives every chart value and counter from the API responses. Pure functions,
// no React, no DOM. Inputs: { stats, analyses } from fetchDashboard().
//
// The redesign's editorial copy is in components/sections.jsx — only NUMBERS
// come from here. Copy decisions are not in this file.

// ─── Configuration ─────────────────────────────────────────────────────────

// The current dataset row has plan_tier="unknown". The legacy dashboard assumed
// Max 5x. When contributors start submitting with a real plan_tier, we'll read
// that field directly and remove this default. Override here if needed.
export const OBSERVED_TIER = "max_5x";

// Plan list prices (USD/month). Pinned to claude.com/pricing 2026-05-01.
// Override at deploy time by passing `--list-price-override` to the CLI — but
// the dashboard derives these client-side.
export const PLAN_PRICES = {
  pro:     { monthly: 20,  capacityMultiplier: 1,  costPerUnit: 20 },
  max_5x:  { monthly: 100, capacityMultiplier: 5,  costPerUnit: 20 },
  max_20x: { monthly: 200, capacityMultiplier: 20, costPerUnit: 10 },
};

// Editorial constants used in the Opus 4.7 advisory. The API does not currently
// expose per-visible-token Q5h cost; when it does, swap these for live values.
// See handoff/README.md → "Known follow-ups".
export const OPUS_47_ADVISORY = {
  burnMultiplier: 2.4,     // 4.7 burns Q5h at ~2.4× of 4.6 per visible token
  apiCostMultiplier: 1.69, // ~+69% API $/turn vs 4.6
  toolCallMultiplier: 2.1, // open issue tracking
};

// ─── Aggregate the deduped analyses ────────────────────────────────────────

export function deriveMetrics({ stats, analyses }) {
  const n = analyses.length;

  // Trust /api/v1/stats for the top-line counters when present
  const contributors    = stats?.distinct_install_ids ?? n;
  const totalApiCalls   = stats?.total_calls ?? sumBy(analyses, (a) => a.n_calls);
  const totalSessions   = stats?.total_sessions ?? sumBy(analyses, (a) => a.n_sessions);
  const analysisReports = n;

  // Days observed: prefer the stats earliest/latest. Fall back to data_range.
  const earliest = stats?.earliest ? new Date(stats.earliest) : earliestDate(analyses);
  const latest   = stats?.latest   ? new Date(stats.latest)   : latestDate(analyses);
  const daysObserved = Math.max(1, daysBetween(earliest, latest));

  // Cost aggregates
  const totalApiCost     = sumBy(analyses, (a) => a.cost_analysis?.total_api_cost || 0);
  const noCacheCost      = sumBy(analyses, (a) => a.cost_analysis?.no_cache_cost || 0);
  const cacheSavingsSum  = sumBy(analyses, (a) => a.cost_analysis?.cache_savings || 0);
  const cacheSavingsPct  = meanBy(analyses, (a) => a.cost_analysis?.cache_savings_pct || 0);

  // Subscription cost paid (computed from observed days × plan price)
  const plan = PLAN_PRICES[OBSERVED_TIER];
  const subscriptionCostPaid = plan ? (plan.monthly / 30) * daysObserved : 0;

  // Monthly projection: extrapolate observed API value to 30 days
  const monthlyProjection = (totalApiCost / daysObserved) * 30;

  // Value multipliers
  const planMultipliers = {
    pro:     monthlyProjection / PLAN_PRICES.max_5x.capacityMultiplier / PLAN_PRICES.pro.monthly,
    max_5x:  monthlyProjection / PLAN_PRICES.max_5x.monthly,
    max_20x: (monthlyProjection * PLAN_PRICES.max_20x.capacityMultiplier / PLAN_PRICES.max_5x.capacityMultiplier) / PLAN_PRICES.max_20x.monthly,
  };
  const planValues = {
    pro:     monthlyProjection / PLAN_PRICES.max_5x.capacityMultiplier,
    max_5x:  monthlyProjection,
    max_20x: monthlyProjection * (PLAN_PRICES.max_20x.capacityMultiplier / PLAN_PRICES.max_5x.capacityMultiplier),
  };

  // Effective multiplier = total API value / subscription cost paid
  const effectiveMultiplier = subscriptionCostPaid > 0 ? totalApiCost / subscriptionCostPaid : 0;

  // OLS coefficients (mean across analyses)
  const olsCoefficients = {
    output:        meanBy(analyses, (a) => a.ols?.coefficients?.avg_output || 0),
    input:         meanBy(analyses, (a) => a.ols?.coefficients?.avg_input || 0),
    cacheCreation: meanBy(analyses, (a) => a.ols?.coefficients?.avg_cache_creation || 0),
    cacheRead:     meanBy(analyses, (a) => a.ols?.coefficients?.avg_cache_read || 0),
    intercept:     meanBy(analyses, (a) => a.ols?.coefficients?.intercept || 0),
  };
  const rSquared = meanBy(analyses, (a) => a.ols?.r_squared || 0);

  // Correlations
  const correlations = {
    output:        meanBy(analyses, (a) => a.correlations?.avg_output || 0),
    input:         meanBy(analyses, (a) => a.correlations?.avg_input || 0),
    cacheCreation: meanBy(analyses, (a) => a.correlations?.avg_cache_creation || 0),
    cacheRead:     meanBy(analyses, (a) => a.correlations?.avg_cache_read || 0),
  };

  // Exponents
  const meanExponent = meanBy(analyses, (a) => a.exponents?.mean || 0);

  // fallback_percentage scalar (we read the first non-null value — it's static
  // per account, so means across accounts are not meaningful)
  const fallbackPct = analyses.find((a) => typeof a.fallback_pct === "number")?.fallback_pct ?? null;

  // Per-model splits — merge across analyses
  const modelSplits = mergeModelSplits(analyses);

  // Peak vs off-peak (mean of means)
  const peakOffPeak = {
    peak:   meanBy(analyses, (a) => a.peak_vs_offpeak?.peak_avg_q5h_per_turn || 0),
    offpeak:meanBy(analyses, (a) => a.peak_vs_offpeak?.offpeak_avg_q5h_per_turn || 0),
  };

  // Per-model API cost per turn (USD), derived from cost_analysis.by_model
  const modelCostPerTurn = deriveModelCostPerTurn(analyses);

  return {
    // top-line counters
    contributors, totalApiCalls, totalSessions, analysisReports, daysObserved,
    earliest, latest,

    // money
    totalApiCost, noCacheCost, cacheSavingsSum, cacheSavingsPct,
    subscriptionCostPaid, monthlyProjection,

    // plans
    plan, planMultipliers, planValues, effectiveMultiplier,

    // regression
    olsCoefficients, rSquared, correlations, meanExponent, fallbackPct,

    // model + time
    modelSplits, peakOffPeak, modelCostPerTurn,

    // pass-through advisory constants (UI reads these too)
    advisory: OPUS_47_ADVISORY,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function sumBy(arr, fn) {
  return arr.reduce((acc, x) => acc + (fn(x) || 0), 0);
}

function meanBy(arr, fn) {
  if (!arr.length) return 0;
  return sumBy(arr, fn) / arr.length;
}

function earliestDate(analyses) {
  let min = Infinity;
  for (const a of analyses) {
    const t = Date.parse(a.data_range?.start || a.generated_at || 0);
    if (Number.isFinite(t) && t < min) min = t;
  }
  return Number.isFinite(min) ? new Date(min) : new Date();
}

function latestDate(analyses) {
  let max = 0;
  for (const a of analyses) {
    const t = Date.parse(a.data_range?.end || a.generated_at || 0);
    if (Number.isFinite(t) && t > max) max = t;
  }
  return new Date(max || Date.now());
}

function daysBetween(a, b) {
  const ms = Math.abs(b.getTime() - a.getTime());
  return Math.max(1, Math.round(ms / 86400000));
}

function mergeModelSplits(analyses) {
  const acc = {};
  for (const a of analyses) {
    const splits = a.model_splits || {};
    for (const [model, m] of Object.entries(splits)) {
      if (!acc[model]) acc[model] = { n_calls: 0, q5hSum: 0, q5hN: 0 };
      acc[model].n_calls += m.n_calls || 0;
      if (typeof m.avg_q5h_per_turn === "number") {
        acc[model].q5hSum += m.avg_q5h_per_turn * (m.n_calls || 1);
        acc[model].q5hN += (m.n_calls || 1);
      }
    }
  }
  const out = {};
  for (const [model, x] of Object.entries(acc)) {
    out[model] = {
      n_calls: x.n_calls,
      avg_q5h_per_turn: x.q5hN > 0 ? x.q5hSum / x.q5hN : 0,
    };
  }
  return out;
}

function deriveModelCostPerTurn(analyses) {
  const acc = {};
  for (const a of analyses) {
    const by = a.cost_analysis?.by_model || {};
    for (const [model, m] of Object.entries(by)) {
      if (!acc[model]) acc[model] = { cost: 0, calls: 0 };
      acc[model].cost += m.cost || 0;
      acc[model].calls += m.calls || 0;
    }
  }
  const out = {};
  for (const [model, x] of Object.entries(acc)) {
    out[model] = x.calls > 0 ? x.cost / x.calls : 0;
  }
  return out;
}

// ─── Formatting helpers (used across components) ───────────────────────────

export const fmt$ = (n) => "$" + Math.round(n || 0).toLocaleString();
export const fmtN = (n) => (n || 0).toLocaleString();
export const fmtPct = (n, digits = 0) => (n || 0).toFixed(digits) + "%";
