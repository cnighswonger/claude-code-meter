import { readAllRows, groupBySession } from "../log/reader.mjs";
import { LOG_FILE, DEFAULT_SERVER, KNOWN_RATES, RATES_LAST_VERIFIED, RATES_SOURCE_URL, PLAN_LIST_PRICE_PER_DAY } from "../constants.mjs";
import { getInstallId, getConsentStatus, requestConsent } from "../consent.mjs";

/**
 * Parse --plan-transitions value of the form
 *   "2026-01-01=max-5x,2026-04-15=max-20x"
 * into a sorted array of {date: Date, tier: string} entries.
 *
 * The interpretation: from each date forward (inclusive), the plan tier is
 * the matching value, until the next entry takes effect. Rows before the
 * earliest entry have no plan tier assigned.
 */
function parsePlanTransitions(spec) {
  if (!spec) return [];
  const entries = [];
  for (const seg of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [dateStr, tier] = seg.split("=").map((s) => s.trim());
    if (!dateStr || !tier) {
      throw new Error(`Invalid --plan-transitions segment "${seg}" — expected "YYYY-MM-DD=tier"`);
    }
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid date "${dateStr}" in --plan-transitions`);
    }
    if (!(tier in PLAN_LIST_PRICE_PER_DAY)) {
      throw new Error(`Unknown plan tier "${tier}" in --plan-transitions. Known: ${Object.keys(PLAN_LIST_PRICE_PER_DAY).join(", ")}`);
    }
    entries.push({ date, tier });
  }
  entries.sort((a, b) => a.date - b.date);
  return entries;
}

/**
 * Given a row's timestamp and the parsed transition list, return the plan
 * tier in effect at that time (or null if the row predates the earliest
 * transition).
 */
function planTierAt(rowTs, transitions) {
  if (transitions.length === 0) return null;
  const t = new Date(rowTs);
  let current = null;
  for (const entry of transitions) {
    if (t >= entry.date) current = entry.tier;
    else break;
  }
  return current;
}

/**
 * Parse --list-price-override value of the form
 *   "max-5x=0.83,max-20x=3.33"
 * Returns a {tier: usd_per_day} map merged on top of the defaults.
 */
function parseListPriceOverrides(spec) {
  const overrides = {};
  if (!spec) return overrides;
  for (const seg of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [tier, price] = seg.split("=").map((s) => s.trim());
    const p = parseFloat(price);
    if (!tier || !Number.isFinite(p) || p < 0) {
      throw new Error(`Invalid --list-price-override segment "${seg}" — expected "tier=N.NN"`);
    }
    overrides[tier] = p;
  }
  return overrides;
}

/**
 * Compute M(t) = effective_cost_per_day / list_price_per_day, plus the
 * supporting numbers, for a given subset of rows at a given plan tier.
 *
 * `effective_cost_per_day` derives from the API-equivalent cost (what these
 * tokens would cost at retail Anthropic pricing) divided by the elapsed
 * days the rows span. M(t) > 1 means subscription value exceeds list price
 * at this usage level; M(t) < 1 means the user is paying for capacity they
 * don't consume. Both are interesting; both are public-info-derivable.
 *
 * Returns null if list price is null (api / unknown tiers) or insufficient
 * data to compute.
 */
function computePlanMultiplier(rows, planTier, listPriceOverrides) {
  const overridePrice = listPriceOverrides[planTier];
  const listPrice = overridePrice != null ? overridePrice : PLAN_LIST_PRICE_PER_DAY[planTier];
  if (listPrice == null || listPrice <= 0) return null;
  if (rows.length === 0) return null;

  const cost = computeApiCost(rows);
  const tsStart = new Date(rows[0].ts);
  const tsEnd = new Date(rows[rows.length - 1].ts);
  const daysSpan = Math.max((tsEnd - tsStart) / (24 * 60 * 60 * 1000), 1 / 24);  // floor at 1 hour to avoid divide-by-tiny

  const effectivePerDay = cost.total_api_cost / daysSpan;
  const multiplier = effectivePerDay / listPrice;

  return {
    plan_tier: planTier,
    list_price_per_day: +listPrice.toFixed(4),
    effective_cost_per_day: +effectivePerDay.toFixed(4),
    multiplier_M_t: +multiplier.toFixed(4),
    days_span: +daysSpan.toFixed(2),
    n_calls: rows.length,
    api_equivalent_total: +cost.total_api_cost.toFixed(4),
  };
}

/**
 * Compute M(t) per session and return one row per session.
 *
 * Each session's tier is determined from its first row's timestamp via
 * planTierAt() when transitions are supplied, otherwise the global
 * planTier (or "unknown") is used. Sessions whose tier resolves to a
 * null list price (api / unknown) are dropped.
 */
function computePerSessionMultipliers(rows, planTier, listPriceOverrides, transitions) {
  const bySid = new Map();
  for (const r of rows) {
    if (!bySid.has(r.sid)) bySid.set(r.sid, []);
    bySid.get(r.sid).push(r);
  }
  const results = [];
  for (const [sid, sRows] of bySid) {
    const tier = transitions.length > 0 ? planTierAt(sRows[0].ts, transitions) : (planTier || "unknown");
    const mt = computePlanMultiplier(sRows, tier, listPriceOverrides);
    if (!mt) continue;
    results.push({
      sid,
      plan_tier: tier,
      n_calls: sRows.length,
      days_span: mt.days_span,
      api_equivalent_total: mt.api_equivalent_total,
      effective_cost_per_day: mt.effective_cost_per_day,
      multiplier_M_t: mt.multiplier_M_t,
    });
  }
  return results;
}

function summarizeDistribution(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / sorted.length;
  const pct = (p) => sorted[Math.floor(p * (sorted.length - 1))];
  return {
    n: sorted.length,
    mean: +mean.toFixed(4),
    p25: +pct(0.25).toFixed(4),
    median: +pct(0.5).toFixed(4),
    p75: +pct(0.75).toFixed(4),
    min: +sorted[0].toFixed(4),
    max: +sorted[sorted.length - 1].toFixed(4),
  };
}

/**
 * Compute API-equivalent cost for a set of rows using published rates.
 * Returns { total, breakdown_by_model, cache_savings, no_cache_cost }
 */
function computeApiCost(rows) {
  let total = 0;
  let noCacheTotal = 0;
  const byModel = {};

  for (const r of rows) {
    // Match model to rates — strip date suffix, try progressively shorter names
    const modelKey = r.model?.replace(/-\d{8}$/, "") || "";
    const rates = KNOWN_RATES[modelKey]?.standard;
    if (!rates) continue;

    const inputCost = (r.input_tokens || 0) * rates.input / 1_000_000;
    const outputCost = (r.output_tokens || 0) * rates.output / 1_000_000;
    const cacheReadCost = (r.cache_read_input_tokens || 0) * rates.cache_read / 1_000_000;

    // Determine cache write tier from ephemeral fields
    const is1h = (r.ephemeral_1h_input_tokens || 0) > 0;
    const writeRate = is1h ? rates.cache_write_1h : rates.cache_write_5m;
    const cacheWriteCost = (r.cache_creation_input_tokens || 0) * writeRate / 1_000_000;

    const callCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;
    total += callCost;

    // What would this have cost without any caching?
    const totalInputTokens = (r.input_tokens || 0) + (r.cache_read_input_tokens || 0) + (r.cache_creation_input_tokens || 0);
    const noCacheCost = totalInputTokens * rates.input / 1_000_000 + outputCost;
    noCacheTotal += noCacheCost;

    if (!byModel[modelKey]) byModel[modelKey] = { cost: 0, calls: 0 };
    byModel[modelKey].cost += callCost;
    byModel[modelKey].calls++;
  }

  return {
    total_api_cost: +total.toFixed(4),
    no_cache_cost: +noCacheTotal.toFixed(4),
    cache_savings: +(noCacheTotal - total).toFixed(4),
    cache_savings_pct: noCacheTotal > 0 ? +((1 - total / noCacheTotal) * 100).toFixed(1) : 0,
    by_model: Object.fromEntries(
      Object.entries(byModel).map(([m, d]) => [m, { cost: +d.cost.toFixed(4), calls: d.calls }])
    ),
    rates_verified: RATES_LAST_VERIFIED,
    rates_source: RATES_SOURCE_URL,
    disclaimer: "Estimates based on published API rates. Subscription billing may differ. Verify at source URL.",
  };
}

/**
 * OLS regression: y = Xβ + ε
 * Returns { coefficients: {name: value}, r_squared, predictions }
 * Pure JS — no numpy needed. Small dataset (tens of sessions), matrix ops are fine.
 */
function olsRegression(features, y, featureNames) {
  const n = y.length;
  const k = features[0].length;

  // X = [1, features...] (add intercept column)
  const X = features.map((row) => [1, ...row]);
  const kk = k + 1;

  // X^T X
  const XtX = Array.from({ length: kk }, () => new Float64Array(kk));
  for (let i = 0; i < kk; i++) {
    for (let j = 0; j < kk; j++) {
      let sum = 0;
      for (let r = 0; r < n; r++) sum += X[r][i] * X[r][j];
      XtX[i][j] = sum;
    }
  }

  // X^T y
  const Xty = new Float64Array(kk);
  for (let i = 0; i < kk; i++) {
    let sum = 0;
    for (let r = 0; r < n; r++) sum += X[r][i] * y[r];
    Xty[i] = sum;
  }

  // Solve via Gauss-Jordan elimination
  const aug = XtX.map((row, i) => [...row, Xty[i]]);
  for (let col = 0; col < kk; col++) {
    // Partial pivot
    let maxRow = col;
    for (let row = col + 1; row < kk; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
    }
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-12) {
      // Singular — return nulls
      return { coefficients: Object.fromEntries(featureNames.map((n) => [n, 0])), r_squared: 0, predictions: y.map(() => 0) };
    }
    for (let j = col; j <= kk; j++) aug[col][j] /= pivot;
    for (let row = 0; row < kk; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = col; j <= kk; j++) aug[row][j] -= factor * aug[col][j];
    }
  }

  const beta = aug.map((row) => row[kk]);

  // Predictions and R²
  const predictions = X.map((row) => row.reduce((s, x, i) => s + x * beta[i], 0));
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const ssTot = y.reduce((s, yi) => s + (yi - yMean) ** 2, 0);
  const ssRes = y.reduce((s, yi, i) => s + (yi - predictions[i]) ** 2, 0);
  const r_squared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  const coefficients = { intercept: beta[0] };
  featureNames.forEach((name, i) => {
    coefficients[name] = beta[i + 1];
  });

  return { coefficients, r_squared, predictions };
}

/**
 * Pearson correlation between two arrays.
 */
function pearson(x, y) {
  const n = x.length;
  if (n < 3) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom > 0 ? num / denom : 0;
}

/**
 * Fit cumulative Q5h vs turn index to power law: Q5h_cum(t) = a * t^b
 * Returns exponent b via log-log OLS.
 */
function fitCumulativeExponent(rows) {
  // Compute cumulative Q5h delta
  let cum = 0;
  const points = [];
  for (let i = 0; i < rows.length; i++) {
    cum += Math.max(0, rows[i].q5h_delta || 0);
    if (cum > 0 && i > 0) {
      points.push({ logT: Math.log(i + 1), logQ: Math.log(cum) });
    }
  }
  if (points.length < 3) return null;

  // log-log OLS: logQ = a + b * logT
  const n = points.length;
  const sx = points.reduce((s, p) => s + p.logT, 0);
  const sy = points.reduce((s, p) => s + p.logQ, 0);
  const sxy = points.reduce((s, p) => s + p.logT * p.logQ, 0);
  const sx2 = points.reduce((s, p) => s + p.logT * p.logT, 0);
  const denom = n * sx2 - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  return (n * sxy - sx * sy) / denom;
}

/**
 * Detect plan tier from fallback_pct and quota patterns.
 */
function detectPlanTier(rows) {
  // If any row has high q5h values, likely Max
  const maxQ5h = Math.max(...rows.map((r) => r.q5h || 0));
  const fallback = rows.find((r) => r.qfallback_pct != null)?.qfallback_pct;
  // Heuristic — can't definitively determine from data alone
  return "unknown";
}

/**
 * Main analyze command.
 */
export async function analyzeCommand(args) {
  const allRows = readAllRows(args.logFile || LOG_FILE);
  if (allRows.length === 0) {
    console.error("No data in claude-meter.jsonl. Run Claude Code with the meter interceptor first.");
    process.exit(1);
  }

  // --session <sid> filters to a single session before any analysis.
  // Accepts a full sid or a unique prefix (claude-meter sids are 8-char
  // hex hashes; shorter prefixes are convenient when typing).
  let rows = allRows;
  if (args.session) {
    const matches = allRows.filter((r) => r.sid && r.sid.startsWith(args.session));
    const distinctSids = new Set(matches.map((r) => r.sid));
    if (matches.length === 0) {
      console.error(`No rows matching session prefix '${args.session}'.`);
      process.exit(1);
    }
    if (distinctSids.size > 1) {
      console.error(`Session prefix '${args.session}' is ambiguous — matches ${distinctSids.size} sessions: ${[...distinctSids].join(", ")}`);
      process.exit(1);
    }
    rows = matches;
  }

  const sessions = groupBySession(rows);
  const sessionEntries = [...sessions.entries()].filter(([, rows]) => rows.length >= 3);

  // Regression requires multiple sessions; per-plan / per-session / single-
  // session analyses do not. Only hard-fail when the caller is implicitly
  // asking for the regression view (no targeted flag set).
  const skipRegression = sessionEntries.length < 2;
  if (skipRegression && !args.session && !args["by-plan"] && !args["per-session"]) {
    console.error(`Need at least 2 sessions with 3+ calls each for regression. Found ${sessionEntries.length}.`);
    process.exit(1);
  }

  // Build session-level aggregates
  const sessionData = sessionEntries.map(([sid, sRows]) => {
    const n = sRows.length;
    const totalQ5hDelta = sRows.reduce((s, r) => s + Math.max(0, r.q5h_delta || 0), 0);
    return {
      sid,
      n,
      avg_output: sRows.reduce((s, r) => s + r.output_tokens, 0) / n,
      avg_input: sRows.reduce((s, r) => s + r.input_tokens, 0) / n,
      avg_cache_creation: sRows.reduce((s, r) => s + r.cache_creation_input_tokens, 0) / n,
      avg_cache_read: sRows.reduce((s, r) => s + r.cache_read_input_tokens, 0) / n,
      avg_cache_hit_rate: sRows.reduce((s, r) => s + (r.cache_hit_rate || 0), 0) / n,
      q5h_total_delta: totalQ5hDelta,
      q5h_per_turn: totalQ5hDelta / n,
      peak_fraction: sRows.filter((r) => {
        const d = new Date(r.ts);
        const h = d.getUTCHours();
        const dow = d.getUTCDay();
        return dow >= 1 && dow <= 5 && h >= 13 && h < 19;
      }).length / n,
    };
  });

  // Feature names for regression
  const featureNames = ["avg_output", "avg_input", "avg_cache_creation", "avg_cache_read"];

  // OLS + Pearson are skipped when there aren't enough sessions (e.g.
  // --session filtered down to a single session). Targeted analyses
  // (--by-plan / --per-session) still produce useful output without them.
  let ols = null;
  let correlations = null;
  if (!skipRegression) {
    const features = sessionData.map((s) => [s.avg_output, s.avg_input, s.avg_cache_creation, s.avg_cache_read]);
    const y = sessionData.map((s) => s.q5h_per_turn);
    ols = olsRegression(features, y, featureNames);
    correlations = {};
    for (const name of featureNames) {
      correlations[name] = +pearson(sessionData.map((s) => s[name]), y).toFixed(4);
    }
  }

  // Cumulative exponents per session
  const exponents = [];
  for (const [, sRows] of sessionEntries) {
    const b = fitCumulativeExponent(sRows);
    if (b !== null) exponents.push(b);
  }

  const exponentStats = exponents.length > 0 ? {
    mean: +(exponents.reduce((a, b) => a + b, 0) / exponents.length).toFixed(4),
    median: +exponents.sort((a, b) => a - b)[Math.floor(exponents.length / 2)].toFixed(4),
    std: +Math.sqrt(exponents.reduce((s, b) => s + (b - exponents.reduce((a, b) => a + b, 0) / exponents.length) ** 2, 0) / exponents.length).toFixed(4),
    n_superlinear: exponents.filter((b) => b > 1.3).length,
    n_total: exponents.length,
  } : { mean: 0, median: 0, std: 0, n_superlinear: 0, n_total: 0 };

  // Peak vs off-peak split
  const peakSessions = sessionData.filter((s) => s.peak_fraction > 0.5);
  const offpeakSessions = sessionData.filter((s) => s.peak_fraction <= 0.5);

  // Model splits
  const modelGroups = new Map();
  for (const row of rows) {
    const family = row.model?.replace(/-\d{8}$/, "") || "unknown";
    if (!modelGroups.has(family)) modelGroups.set(family, { calls: 0, q5hSum: 0 });
    const g = modelGroups.get(family);
    g.calls++;
    g.q5hSum += Math.max(0, row.q5h_delta || 0);
  }

  // Detect plan tier
  const fallbackPct = rows.find((r) => r.qfallback_pct != null)?.qfallback_pct;
  const planTier = args.plan || detectPlanTier(rows);
  const nRejected = rows.filter((r) => r.qstatus === "rejected").length;
  const nDrainEvents = rows.filter((r) => (r.q5h || 0) >= 1.0).length;

  // Per-plan M(t) split, if requested.
  // --by-plan enables the section
  // --plan-transitions "YYYY-MM-DD=tier,..." attributes each row to a tier
  //   based on its timestamp; rows without a transition match are bucketed
  //   under the global --plan value (or "unknown")
  // --list-price-override "tier=N.NN,..." overrides PLAN_LIST_PRICE_PER_DAY
  //   defaults for one or more tiers (use when actual pricing differs)
  let byPlan = null;
  if (args["by-plan"]) {
    const transitions = parsePlanTransitions(args["plan-transitions"]);
    const listPriceOverrides = parseListPriceOverrides(args["list-price-override"]);
    const buckets = new Map();
    for (const row of rows) {
      let tier = transitions.length > 0 ? planTierAt(row.ts, transitions) : null;
      if (!tier) tier = planTier || "unknown";
      if (!buckets.has(tier)) buckets.set(tier, []);
      buckets.get(tier).push(row);
    }
    byPlan = {};
    for (const [tier, tierRows] of buckets) {
      const mt = computePlanMultiplier(tierRows, tier, listPriceOverrides);
      byPlan[tier] = mt || {
        plan_tier: tier,
        list_price_per_day: null,
        note: "M(t) not computed — list price is null for this tier (api / unknown / unconfigured)",
        n_calls: tierRows.length,
      };
    }
  }

  // Per-session M(t) distribution, if requested.
  // --per-session emits one row per session with its own M(t), plus
  // distribution summaries (n / mean / p25 / median / p75 / min / max).
  // When combined with --by-plan or --plan-transitions, distributions are
  // also broken out per tier. This is the apples-to-apples comparison
  // mode for cross-tool benchmarks where the other tool reports a single
  // session's number rather than a host-aggregate.
  let perSession = null;
  if (args["per-session"]) {
    const transitions = parsePlanTransitions(args["plan-transitions"]);
    const listPriceOverrides = parseListPriceOverrides(args["list-price-override"]);
    const sessionMts = computePerSessionMultipliers(rows, planTier, listPriceOverrides, transitions);
    if (sessionMts.length > 0) {
      const distOverall = summarizeDistribution(sessionMts.map((s) => s.multiplier_M_t));
      const byTier = {};
      const tierBuckets = new Map();
      for (const s of sessionMts) {
        if (!tierBuckets.has(s.plan_tier)) tierBuckets.set(s.plan_tier, []);
        tierBuckets.get(s.plan_tier).push(s.multiplier_M_t);
      }
      for (const [tier, vals] of tierBuckets) byTier[tier] = summarizeDistribution(vals);
      perSession = {
        distribution_overall: distOverall,
        distribution_by_tier: byTier,
        sessions: sessionMts.sort((a, b) => b.multiplier_M_t - a.multiplier_M_t),
      };
    } else {
      perSession = { note: "No sessions yielded an M(t) — list price null for all detected tiers." };
    }
  }

  // Build output
  const summary = {
    v: 1,
    generated_at: new Date().toISOString(),
    install_id: getInstallId(),
    data_range: {
      start: rows[0].ts,
      end: rows[rows.length - 1].ts,
    },
    plan_tier: planTier,
    billing_type: rows.some(r => (r.q5h || 0) > 0) ? "subscription" : rows.some(r => r.qstatus) ? "subscription" : "api",
    ...(fallbackPct != null && { fallback_pct: fallbackPct }),
    n_sessions: sessionEntries.length,
    n_calls: rows.length,
    n_drain_events: nDrainEvents,
    n_rejected: nRejected,
    ...(ols && {
      ols: {
        r_squared: +ols.r_squared.toFixed(4),
        coefficients: Object.fromEntries(
          Object.entries(ols.coefficients).map(([k, v]) => [k, +v.toExponential(4)])
        ),
      },
    }),
    ...(correlations && { correlations }),
    exponents: exponentStats,
    ...(peakSessions.length > 0 && offpeakSessions.length > 0 && {
      peak_vs_offpeak: {
        peak_avg_q5h_per_turn: +(peakSessions.reduce((s, d) => s + d.q5h_per_turn, 0) / peakSessions.length).toFixed(6),
        offpeak_avg_q5h_per_turn: +(offpeakSessions.reduce((s, d) => s + d.q5h_per_turn, 0) / offpeakSessions.length).toFixed(6),
      },
    }),
    model_splits: Object.fromEntries(
      [...modelGroups.entries()].map(([model, g]) => [
        model,
        { n_calls: g.calls, avg_q5h_per_turn: +(g.q5hSum / g.calls).toFixed(6) },
      ])
    ),
    cost_analysis: computeApiCost(rows),
    ...(byPlan && { by_plan: byPlan }),
    ...(perSession && { per_session: perSession }),
    model_spoofing: (() => {
      const mismatches = rows.filter(r => r.model_mismatch);
      if (mismatches.length === 0 && !rows.some(r => r.requested_model)) {
        return { status: "not_tracked", note: "Upgrade claude-code-meter to capture requested_model" };
      }
      if (mismatches.length === 0) {
        return { status: "none_detected", checked: rows.filter(r => r.requested_model).length };
      }
      const transitions = [];
      for (const m of mismatches) {
        transitions.push({ requested: m.requested_model, served: m.model });
      }
      const grouped = {};
      for (const t of transitions) {
        const key = `${t.requested} → ${t.served}`;
        grouped[key] = (grouped[key] || 0) + 1;
      }
      return {
        status: "detected",
        total_mismatches: mismatches.length,
        mismatch_rate: +(mismatches.length / rows.length * 100).toFixed(2),
        transitions: grouped,
      };
    })(),
  };

  if (args.share) {
    // Consent gate — first-run requires interactive consent, subsequent runs honor --yes
    const consentToken = await requestConsent(args.yes);
    if (!consentToken) {
      // Still output the analysis locally even if consent denied
      console.log(JSON.stringify(summary, null, 2));
      return summary;
    }

    // Add consent token to submission
    summary.consent_token = consentToken;

    const jsonStr = JSON.stringify(summary, null, 2);
    console.log("Data to share:\n");
    console.log(jsonStr);
    console.log(`\nSize: ${JSON.stringify(summary).length} bytes | Consent: ${consentToken.slice(0, 8)}...`);

    const endpoint = args.endpoint || DEFAULT_SERVER;
    const url = `${endpoint}/api/v1/submit`;
    try {
      const res = await globalThis.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(summary),
      });
      const body = await res.json();
      if (res.ok) {
        console.log(`\nSubmitted successfully (${body.type}). Thank you!`);
        console.log(`View community stats: ${endpoint}/api/v1/stats`);
      } else {
        console.error(`\nSubmission failed (${res.status}): ${body.error || "unknown error"}`);
        if (body.issues) body.issues.forEach((i) => console.error(`  ${i.path}: ${i.message}`));
      }
    } catch (e) {
      console.error(`\nConnection failed: ${e.message}`);
      console.error("You can submit manually by POSTing the JSON above to:");
      console.error(`  curl -X POST -H 'Content-Type: application/json' -d @- ${url}`);
    }
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }

  return summary;
}
