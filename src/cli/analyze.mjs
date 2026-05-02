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
  // Strict ISO date format (YYYY-MM-DD) — rejects ambiguous dates like "2026"
  // or "Jan 1" that Date() would otherwise silently accept.
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  for (const seg of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const parts = seg.split("=");
    if (parts.length !== 2) {
      throw new Error(`Invalid --plan-transitions segment "${seg}" — expected exactly one "=" (got ${parts.length - 1})`);
    }
    const [dateStr, tier] = parts.map((s) => s.trim());
    if (!dateStr || !tier) {
      throw new Error(`Invalid --plan-transitions segment "${seg}" — expected "YYYY-MM-DD=tier"`);
    }
    if (!datePattern.test(dateStr)) {
      throw new Error(`Invalid date "${dateStr}" in --plan-transitions — expected YYYY-MM-DD`);
    }
    const date = new Date(dateStr + "T00:00:00Z");
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid date "${dateStr}" in --plan-transitions`);
    }
    // JS Date silently normalizes impossible dates (e.g. 2026-02-31 → 2026-03-03).
    // Roundtrip-check the components so users see typos instead of silent shift.
    if (date.toISOString().slice(0, 10) !== dateStr) {
      throw new Error(`Invalid date "${dateStr}" in --plan-transitions — not a real calendar date (would normalize to ${date.toISOString().slice(0, 10)})`);
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
  // Strict numeric format — rejects garbage suffixes that parseFloat() would
  // silently accept (e.g. "3.33junk" → 3.33).
  const numberPattern = /^-?\d+(\.\d+)?$/;
  for (const seg of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const parts = seg.split("=");
    if (parts.length !== 2) {
      throw new Error(`Invalid --list-price-override segment "${seg}" — expected exactly one "=" (got ${parts.length - 1})`);
    }
    const [tier, price] = parts.map((s) => s.trim());
    if (!tier) {
      throw new Error(`Invalid --list-price-override segment "${seg}" — empty tier`);
    }
    if (!numberPattern.test(price)) {
      throw new Error(`Invalid --list-price-override price "${price}" for tier "${tier}" — expected a plain number like "3.33"`);
    }
    const p = Number(price);
    if (!Number.isFinite(p) || p < 0) {
      throw new Error(`Invalid --list-price-override segment "${seg}" — expected "tier=N.NN" with N >= 0`);
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
/**
 * Compute the amortized cost multiplier M(t) for a set of rows.
 *
 * Methodology (the presupposition we publish under):
 *   M(t) = sum(api_equivalent_cost) / (subscription_daily_price * calendar_days_in_window)
 *
 * The denominator is calendar days, not active-session time. A subscription
 * is paying for every day of the window whether you used it or not, so the
 * idle days count too. This biases M(t) DOWN for sporadic users (good — it
 * tells them honestly that they aren't extracting much from the sub) and
 * gives heavy users no false credit for short bursts.
 *
 * Window length is the inclusive calendar-day span: `last_day - first_day
 * + 1` in UTC. A single 5-minute session counts as 1 day. A 3-day gap
 * mid-window still counts as part of the denominator — the subscription
 * was paying for those days even if you didn't log in. This matches the
 * methodology we publish under (idle days count) and avoids the
 * 1h-floor pathology that inflates short bursts.
 *
 * Returns null when the plan has no list price (api / unknown / api keys).
 */
function computePlanMultiplier(rows, planTier, listPriceOverrides) {
  const overridePrice = listPriceOverrides[planTier];
  const listPrice = overridePrice != null ? overridePrice : PLAN_LIST_PRICE_PER_DAY[planTier];
  if (listPrice == null || listPrice <= 0) return null;
  if (rows.length === 0) return null;

  const cost = computeApiCost(rows);

  // Inclusive UTC calendar-day span: last - first + 1. Counts gap days
  // the subscription was paying for, even if no calls landed.
  // Compute via min/max scan (not rows[0] / rows[length-1]) so the result
  // is robust to non-chronological input — readAllRows() preserves file
  // order and merged inputs may interleave timestamps.
  let firstMs = Infinity, lastMs = -Infinity;
  for (const r of rows) {
    const ms = Date.parse(r.ts.slice(0, 10) + "T00:00:00Z");
    if (ms < firstMs) firstMs = ms;
    if (ms > lastMs) lastMs = ms;
  }
  const calendarDays = Math.max(Math.round((lastMs - firstMs) / 86400000) + 1, 1);

  const subWindowCost = listPrice * calendarDays;
  const multiplier = cost.total_api_cost / subWindowCost;
  const effectivePerDay = cost.total_api_cost / calendarDays;

  return {
    plan_tier: planTier,
    list_price_per_day: +listPrice.toFixed(4),
    calendar_days: calendarDays,
    sub_window_cost: +subWindowCost.toFixed(4),
    effective_cost_per_day: +effectivePerDay.toFixed(4),
    multiplier_M_t: +multiplier.toFixed(4),
    n_calls: rows.length,
    api_equivalent_total: +cost.total_api_cost.toFixed(4),
    methodology: "amortized_calendar_days",
  };
}

/**
 * Burn-intensity variant — the OLD per-span formula, kept as an opt-in
 * diagnostic. Tells you "if this session's burn rate were sustained for
 * 24 hours, what M(t) would that imply?" Useful for ranking sessions by
 * intensity; misleading when reported as a standalone M(t) because short
 * sessions extrapolate wildly above sustainable rates.
 */
function computeBurnIntensity(rows, planTier, listPriceOverrides) {
  const overridePrice = listPriceOverrides[planTier];
  const listPrice = overridePrice != null ? overridePrice : PLAN_LIST_PRICE_PER_DAY[planTier];
  if (listPrice == null || listPrice <= 0) return null;
  if (rows.length === 0) return null;

  const cost = computeApiCost(rows);
  // min/max ts scan — robust to non-chronological input order
  let firstMs = Infinity, lastMs = -Infinity;
  for (const r of rows) {
    const ms = Date.parse(r.ts);
    if (ms < firstMs) firstMs = ms;
    if (ms > lastMs) lastMs = ms;
  }
  const daysSpan = Math.max((lastMs - firstMs) / (24 * 60 * 60 * 1000), 1 / 24);

  const effectivePerDay = cost.total_api_cost / daysSpan;
  const intensity = effectivePerDay / listPrice;

  return {
    plan_tier: planTier,
    list_price_per_day: +listPrice.toFixed(4),
    days_span: +daysSpan.toFixed(4),
    effective_cost_per_day: +effectivePerDay.toFixed(4),
    burn_intensity: +intensity.toFixed(4),
    n_calls: rows.length,
    api_equivalent_total: +cost.total_api_cost.toFixed(4),
    methodology: "session_span_extrapolated",
    caveat: "Sub-day sessions extrapolate above sustainable rates; do not interpret as M(t)",
  };
}

/**
 * Per-session "share of subscription value" — how many sub-days of value
 * each session consumed. No time normalization, no extrapolation:
 *
 *   sub_days_consumed = session_api_equivalent_cost / daily_sub_price
 *
 * A 30-minute session that costs $5 of API-equivalent on a $3.33/day
 * Max-5x sub consumed 1.5 sub-days of value. A user who racks up 20
 * sub-days of value across a 30-day billing cycle on a $100/month plan
 * has effectively gotten ~67% of their subscription's nominal worth back.
 *
 * This is a strictly bounded, defensible per-session metric — it answers
 * a question (was this session's API-equivalent cost worth more or less
 * than a day of my sub?) without making claims about sustained rates the
 * data doesn't support.
 *
 * Bucketing key is (sid, tier) — each row's tier is resolved from its own
 * timestamp via planTierAt() when transitions are supplied. A session that
 * spans a tier transition (e.g. you upgraded from Max-5x to Max-20x mid-
 * session) emits one entry per tier-segment, with the tier in the output.
 *
 * Buckets whose tier resolves to a null list price are dropped.
 */
function computePerSessionShare(rows, planTier, listPriceOverrides, transitions) {
  // Bucket by (sid, tier) — per-row tier resolution so cross-transition
  // sessions split into one bucket per tier rather than being misattributed
  // to whichever tier rows[0] happened to land in.
  const buckets = new Map();
  for (const r of rows) {
    const tier = transitions.length > 0 ? planTierAt(r.ts, transitions) : (planTier || "unknown");
    const key = `${r.sid}\x00${tier}`;
    if (!buckets.has(key)) buckets.set(key, { sid: r.sid, tier, rows: [] });
    buckets.get(key).rows.push(r);
  }
  const results = [];
  for (const { sid, tier, rows: bRows } of buckets.values()) {
    const overridePrice = listPriceOverrides[tier];
    const listPrice = overridePrice != null ? overridePrice : PLAN_LIST_PRICE_PER_DAY[tier];
    if (listPrice == null || listPrice <= 0) continue;
    const cost = computeApiCost(bRows);
    const subDaysConsumed = cost.total_api_cost / listPrice;
    results.push({
      sid,
      plan_tier: tier,
      n_calls: bRows.length,
      api_equivalent_total: +cost.total_api_cost.toFixed(4),
      sub_days_consumed: +subDaysConsumed.toFixed(4),
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
  // --share is incompatible with --session: single-session payloads aren't
  // statistically useful for the community dataset, and the server-side
  // submit gate requires the OLS block which --session-mode skips.
  if (args.share && args.session) {
    console.error("--share is not compatible with --session.");
    console.error("  --session reduces to a single session, which can't produce the OLS regression");
    console.error("  the community dataset is built on. Run --session locally for inspection,");
    console.error("  or run --share without --session to contribute aggregate data.");
    process.exit(1);
  }

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
  if (skipRegression && !args.session && !args["by-plan"] && !args["per-session"] && !args["burn-intensity"]) {
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

  // Per-session "share of subscription value" — sub-days consumed per
  // session. Strictly bounded, no extrapolation. See computePerSessionShare.
  let perSession = null;
  if (args["per-session"]) {
    const transitions = parsePlanTransitions(args["plan-transitions"]);
    const listPriceOverrides = parseListPriceOverrides(args["list-price-override"]);
    const sessionShares = computePerSessionShare(rows, planTier, listPriceOverrides, transitions);
    if (sessionShares.length > 0) {
      const distOverall = summarizeDistribution(sessionShares.map((s) => s.sub_days_consumed));
      const byTier = {};
      const tierBuckets = new Map();
      for (const s of sessionShares) {
        if (!tierBuckets.has(s.plan_tier)) tierBuckets.set(s.plan_tier, []);
        tierBuckets.get(s.plan_tier).push(s.sub_days_consumed);
      }
      for (const [tier, vals] of tierBuckets) byTier[tier] = summarizeDistribution(vals);
      perSession = {
        metric: "sub_days_consumed",
        definition: "session_api_equivalent_cost / daily_subscription_price",
        distribution_overall: distOverall,
        distribution_by_tier: byTier,
        sessions: sessionShares.sort((a, b) => b.sub_days_consumed - a.sub_days_consumed),
      };
    } else {
      perSession = { note: "No sessions yielded a value — list price null for all detected tiers." };
    }
  }

  // Burn intensity (opt-in diagnostic). Old --by-plan formula, kept as
  // a separate output to inspect session-level burn rates without
  // confusing them with the amortized M(t) report.
  let burnIntensity = null;
  if (args["burn-intensity"]) {
    const transitions = parsePlanTransitions(args["plan-transitions"]);
    const listPriceOverrides = parseListPriceOverrides(args["list-price-override"]);
    const buckets = new Map();
    for (const row of rows) {
      let tier = transitions.length > 0 ? planTierAt(row.ts, transitions) : null;
      if (!tier) tier = planTier || "unknown";
      if (!buckets.has(tier)) buckets.set(tier, []);
      buckets.get(tier).push(row);
    }
    burnIntensity = {};
    for (const [tier, tierRows] of buckets) {
      const bi = computeBurnIntensity(tierRows, tier, listPriceOverrides);
      burnIntensity[tier] = bi || {
        plan_tier: tier,
        list_price_per_day: null,
        note: "Burn intensity not computed — list price is null for this tier",
        n_calls: tierRows.length,
      };
    }
  }

  // data_range — min/max ts scan, robust to non-chronological input
  let dataRangeStart = rows[0].ts, dataRangeEnd = rows[0].ts;
  for (const r of rows) {
    if (r.ts < dataRangeStart) dataRangeStart = r.ts;
    if (r.ts > dataRangeEnd) dataRangeEnd = r.ts;
  }

  // Build output
  const summary = {
    v: 1,
    generated_at: new Date().toISOString(),
    install_id: getInstallId(),
    data_range: {
      start: dataRangeStart,
      end: dataRangeEnd,
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
    ...(burnIntensity && { burn_intensity: burnIntensity }),
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

    // Build submit payload — strip local-only blocks (by_plan / per_session
    // / burn_intensity) that the server schema doesn't admit and that
    // contain host-aggregate cost data the community dataset doesn't need.
    // The full summary object is still printed below so the user sees their
    // local analysis in full; only the submitted payload is stripped.
    const { by_plan, per_session, burn_intensity, ...submitPayload } = summary;
    submitPayload.consent_token = consentToken;

    const jsonStr = JSON.stringify(summary, null, 2);
    console.log("Local analysis:\n");
    console.log(jsonStr);
    if (by_plan || per_session || burn_intensity) {
      const stripped = [by_plan && "by_plan", per_session && "per_session", burn_intensity && "burn_intensity"].filter(Boolean);
      console.log(`\nNote: ${stripped.join(", ")} block${stripped.length > 1 ? "s" : ""} stripped from submission (local-only).`);
    }
    console.log(`\nSubmit size: ${JSON.stringify(submitPayload).length} bytes | Consent: ${consentToken.slice(0, 8)}...`);

    const endpoint = args.endpoint || DEFAULT_SERVER;
    const url = `${endpoint}/api/v1/submit`;
    try {
      const res = await globalThis.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitPayload),
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
