import { readAllRows, groupBySession } from "../log/reader.mjs";
import { LOG_FILE } from "../constants.mjs";

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
  const rows = readAllRows(args.logFile || LOG_FILE);
  if (rows.length === 0) {
    console.error("No data in claude-meter.jsonl. Run Claude Code with the meter interceptor first.");
    process.exit(1);
  }

  const sessions = groupBySession(rows);
  const sessionEntries = [...sessions.entries()].filter(([, rows]) => rows.length >= 3);

  if (sessionEntries.length < 2) {
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
  const features = sessionData.map((s) => [s.avg_output, s.avg_input, s.avg_cache_creation, s.avg_cache_read]);
  const y = sessionData.map((s) => s.q5h_per_turn);

  // Run OLS
  const ols = olsRegression(features, y, featureNames);

  // Pearson correlations
  const correlations = {};
  for (const name of featureNames) {
    correlations[name] = +pearson(sessionData.map((s) => s[name]), y).toFixed(4);
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

  // Build output
  const summary = {
    v: 1,
    generated_at: new Date().toISOString(),
    data_range: {
      start: rows[0].ts,
      end: rows[rows.length - 1].ts,
    },
    plan_tier: planTier,
    ...(fallbackPct != null && { fallback_pct: fallbackPct }),
    n_sessions: sessionEntries.length,
    n_calls: rows.length,
    n_drain_events: nDrainEvents,
    n_rejected: nRejected,
    ols: {
      r_squared: +ols.r_squared.toFixed(4),
      coefficients: Object.fromEntries(
        Object.entries(ols.coefficients).map(([k, v]) => [k, +v.toExponential(4)])
      ),
    },
    correlations,
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
  };

  if (args.share) {
    console.log("Summary to share:\n");
    console.log(JSON.stringify(summary, null, 2));
    console.log(`\nSize: ${JSON.stringify(summary).length} bytes`);
    // TODO: POST to server when endpoint is ready
    console.log("\nServer endpoint not yet deployed. Copy the JSON above to share manually.");
  } else {
    console.log(JSON.stringify(summary, null, 2));
  }

  return summary;
}
