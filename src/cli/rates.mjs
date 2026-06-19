import { readAllRows, filterByQuotaWindow, groupByQuotaWindow } from "../log/reader.mjs";
import { KNOWN_RATES } from "../constants.mjs";
import { appendFit, readLedger, filterFits } from "./weights-ledger.mjs";

const DEPRECATION_NOTICE =
  "DEPRECATED: --by row produces unreliable weights (R² is typically negative\n" +
  "on real data). Defaulting to --by window in v0.8.1 and removing --by row\n" +
  "in v0.9.0. See https://github.com/cnighswonger/claude-code-meter/issues/33\n";

/**
 * Estimate $/MTok rates by token type using OLS regression.
 *
 * Two modes:
 *   --by window (default, v0.8.1+): per-Q5h-window regression. Aggregates rows
 *     into windows by q5h_reset; y = window q5h_max, X = summed tokens per
 *     window. Recovers usable weights (R² ≈ 0.71 on real data).
 *   --by row (deprecated): legacy per-row OLS on q5h_delta. Dominated by the
 *     API's 0.01 q5h quantization floor; weights diverge from validation.
 *
 * OLS normal equations: w = (X^T X)^{-1} X^T y
 */
export function ratesCommand(args) {
  // --history reads the ledger and does not touch the log.
  if (args.history) {
    runHistory(args);
    return;
  }

  const rows = readAllRows(args.logFile);
  if (rows.length === 0) {
    console.log("No usage data found.");
    return;
  }

  if (args.refit) {
    runRefit(rows, args);
    return;
  }

  const by = args.by ?? "window";
  if (by === "row") {
    runRowMode(rows);
    return;
  }
  runWindowMode(rows, args["tier-start-date"]);
}

// -- window mode --------------------------------------------------------------

function runWindowMode(rows, tierStartDate) {
  const filtered = rows.filter((r) => typeof r.ts === "string" && r.ts.slice(0, 10) >= tierStartDate);
  if (filtered.length === 0) {
    console.log(`No rows at or after --tier-start-date ${tierStartDate}.`);
    return;
  }

  const cacheFixLabel = detectCacheFixLabel(filtered);
  const pairs = buildPairs(filtered);

  if (pairs === null) {
    console.log("No quota windows found in the filtered rows (missing q5h_reset).");
    return;
  }
  if (pairs.size === 0) {
    console.log(
      "No qualifying single-model windows after excluding the in-progress current window.\n" +
        "Collect more data or use deprecated --by row for legacy comparison.",
    );
    return;
  }

  for (const pair of pairs.values()) {
    renderFit(pair, fitPair(pair), cacheFixLabel);
  }
}

/**
 * Group filtered rows into per-(model|speed) pairs of single-model windows,
 * excluding the in-progress current window (the largest q5h_reset) and any
 * mixed-model window. Returns null if no windows exist at all, otherwise a
 * Map<pairKey, {model, speed, windows}>.
 */
function buildPairs(filtered) {
  const windows = groupByQuotaWindow(filtered);
  if (windows.size === 0) return null;

  const sortedResets = [...windows.keys()].sort((a, b) => a - b);
  const inProgressReset = sortedResets[sortedResets.length - 1];

  const pairs = new Map();
  for (const [reset, w] of windows) {
    if (reset === inProgressReset) continue;
    const pairKey = singlePairOf(w.rows);
    if (pairKey === null) continue; // mixed window — dropped from every fit
    if (!pairs.has(pairKey)) {
      const [model, speed] = pairKey.split("|");
      pairs.set(pairKey, { model, speed, windows: [] });
    }
    pairs.get(pairKey).windows.push(w);
  }
  return pairs;
}

/**
 * Compute the OLS fit for one (model|speed) pair. Pure — no console output.
 * Returns one of:
 *   { status: "no_qualifying" }
 *   { status: "too_few", qualifying }
 *   { status: "singular", qualifying, totalRows }
 *   { status: "ok", qualifying, totalRows, weights, rSquared,
 *     holdoutPredictedPp, holdoutActualPp, holdoutErrorPct }
 */
function fitPair(pair) {
  const qualifying = pair.windows
    .filter((w) => w.q5h_max >= 0.1 && w.rows.length >= 20)
    .sort((a, b) => a.q5h_reset - b.q5h_reset);

  if (qualifying.length === 0) return { status: "no_qualifying" };

  const totalRows = qualifying.reduce((acc, w) => acc + w.rows.length, 0);
  if (qualifying.length < 2) return { status: "too_few", qualifying, totalRows };

  const holdOut = qualifying[qualifying.length - 1];
  const fitWindows = qualifying.slice(0, -1);

  // Build X, y from aggregated windows. y is q5h_max in percentage points (×100)
  // and X columns are token counts in millions, so recovered weights are
  // pp-per-Mtok. Column means can span ~2500x (cache_read mean ~195 Mtok vs
  // input mean ~0.08 Mtok on real logs); we mean-scale columns before the
  // Gauss-Jordan inversion so the condition number stays bounded. This
  // rescaling is mathematically equivalent to solving on the raw columns and
  // is invariant on well-conditioned matrices, but it prevents singular-matrix
  // failures on degenerate-but-valid synthetic inputs.
  const rawX = fitWindows.map((w) => aggregateTokens(w.rows));
  const y = fitWindows.map((w) => w.q5h_max * 100);

  const colMeans = rawX[0].map((_, j) => rawX.reduce((s, row) => s + row[j], 0) / rawX.length);
  const safeMeans = colMeans.map((m) => (m === 0 ? 1 : m));
  const scaledX = rawX.map((row) => row.map((x, j) => x / safeMeans[j]));

  const scaledWeights = olsRegression(scaledX, y);
  if (!scaledWeights) return { status: "singular", qualifying, totalRows };
  const weights = scaledWeights.map((w, j) => w / safeMeans[j]);

  const yMean = y.reduce((a, b) => a + b, 0) / y.length;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < y.length; i++) {
    const yHat = rawX[i].reduce((sum, x, j) => sum + x * weights[j], 0);
    ssRes += (y[i] - yHat) ** 2;
    ssTot += (y[i] - yMean) ** 2;
  }
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  const holdoutTokens = aggregateTokens(holdOut.rows);
  const holdoutPredictedPp = holdoutTokens.reduce((sum, x, j) => sum + x * weights[j], 0);
  const holdoutActualPp = holdOut.q5h_max * 100;
  const holdoutErrorPct =
    holdoutActualPp !== 0 ? Math.abs(holdoutPredictedPp - holdoutActualPp) / holdoutActualPp : 0;

  return {
    status: "ok",
    qualifying,
    totalRows,
    weights,
    rSquared,
    holdoutPredictedPp,
    holdoutActualPp,
    holdoutErrorPct,
  };
}

function renderFit(pair, fit, cacheFixLabel) {
  console.log(`\nModel: ${pair.model} (${pair.speed})`);

  if (fit.status === "no_qualifying") {
    console.log(
      `  No qualifying windows for ${pair.model}|${pair.speed}. ` +
        "Collect more data or use deprecated --by row for legacy comparison.",
    );
    return;
  }

  const modeLine =
    `Mode: window (${fit.qualifying.length} Q5h windows aggregated from ${fit.totalRows} rows` +
    (cacheFixLabel ? `, ${cacheFixLabel}` : "") +
    ")";
  console.log(modeLine);

  if (fit.status === "too_few") {
    console.log(
      `  Only ${fit.qualifying.length} qualifying window(s); need at least 2 (fit + hold-out). ` +
        "Collect more data or use deprecated --by row for legacy comparison.",
    );
    return;
  }
  if (fit.status === "singular") {
    console.log("  Regression failed (singular matrix).");
    return;
  }

  if (fit.qualifying.length < 20) {
    console.log(
      `  Insufficient data (${fit.qualifying.length} qualifying windows, threshold 20) — ` +
        "fit reported as low-confidence.",
    );
  }

  console.log(`  R-squared:                   ${fit.rSquared.toFixed(4)}`);
  console.log(
    `  Held-out window error:       ${(fit.holdoutErrorPct * 100).toFixed(1)}% ` +
      `(predicted ${fit.holdoutPredictedPp.toFixed(1)} pp vs actual ${fit.holdoutActualPp.toFixed(1)} pp)`,
  );

  const labels = ["Input", "Output", "Cache Read", "Cache Write"];
  const inputWeight = fit.weights[0] || 1;

  console.log(`\n  Relative billing weights (normalized to input = 1.0):`);
  for (let i = 0; i < 4; i++) {
    const relative = fit.weights[i] / inputWeight;
    console.log(`    ${labels[i].padEnd(14)} ${relative.toFixed(3)}`);
  }

  const modelBase = pair.model.replace(/-\d{8}$/, "");
  const knownKey = Object.keys(KNOWN_RATES).find((k) => modelBase.startsWith(k));
  if (knownKey && KNOWN_RATES[knownKey][pair.speed]) {
    const known = KNOWN_RATES[knownKey][pair.speed];
    const knownInput = known.input || 1;
    console.log(`\n  Known API rate ratios (for comparison):`);
    console.log(`    Input          1.000`);
    console.log(`    Output         ${(known.output / knownInput).toFixed(3)}`);
    console.log(`    Cache Read     ${(known.cache_read / knownInput).toFixed(3)}`);
    console.log(`    Cache Write    ${(known.cache_write / knownInput).toFixed(3)}`);
  }

  console.log(`\n  Raw weights (q5h percentage points per Mtok):`);
  for (let i = 0; i < 4; i++) {
    console.log(`    ${labels[i].padEnd(14)} ${fit.weights[i].toExponential(4)}`);
  }
}

// -- refit / history (Phase 1 ledger) -----------------------------------------

const STORAGE_KEYS = ["input", "output", "cache_read", "cache_create"];

function runRefit(rows, args) {
  const tierStartDate = args["tier-start-date"];
  const filtered = rows.filter((r) => typeof r.ts === "string" && r.ts.slice(0, 10) >= tierStartDate);
  if (filtered.length === 0) {
    console.log(`No rows at or after --tier-start-date ${tierStartDate}.`);
    return;
  }

  const cacheFixLabel = detectCacheFixLabel(filtered);
  const pairs = buildPairs(filtered);

  if (pairs === null) {
    console.log("No quota windows found in the filtered rows (missing q5h_reset).");
    return;
  }
  if (pairs.size === 0) {
    console.log(
      "No qualifying single-model windows after excluding the in-progress current window.\n" +
        "Collect more data or use deprecated --by row for legacy comparison.",
    );
    return;
  }

  const fitAt = new Date().toISOString();
  let appended = 0;
  for (const pair of pairs.values()) {
    const fit = fitPair(pair);
    renderFit(pair, fit, cacheFixLabel);
    if (fit.status !== "ok") continue; // only durable fits enter the ledger

    appendFit(args.ledgerFile, {
      fit_at: fitAt,
      tier: args.plan,
      tier_started: tierStartDate,
      model: pair.model,
      speed: pair.speed,
      window_count: fit.qualifying.length,
      rows_total: fit.totalRows,
      r_squared: round(fit.rSquared, 4),
      weights: {
        input: round(fit.weights[0], 4),
        output: round(fit.weights[1], 4),
        cache_read: round(fit.weights[2], 4),
        cache_create: round(fit.weights[3], 4),
      },
      validation: {
        method: "hold-out-most-recent",
        predicted_pp: round(fit.holdoutPredictedPp, 1),
        actual_pp: round(fit.holdoutActualPp, 1),
        error_pct: round(fit.holdoutErrorPct * 100, 1),
      },
      cache_fix_label: cacheFixLabel,
    });
    appended++;
  }

  console.log(
    `\nRecorded ${appended} fit${appended === 1 ? "" : "s"} to the weight history ledger.`,
  );
}

function runHistory(args) {
  const ledger = readLedger(args.ledgerFile);
  const fits = filterFits(ledger.fits, { tier: args.plan, model: args.model });

  if (fits.length === 0) {
    console.log("No fits in the weight history ledger.");
    return;
  }

  // Most-recent first.
  const ordered = [...fits].sort((a, b) => (a.fit_at < b.fit_at ? 1 : a.fit_at > b.fit_at ? -1 : 0));

  console.log("Weight history (most-recent first):\n");
  for (const f of ordered) {
    const w = f.weights || {};
    const label = f.cache_fix_label ? `, ${f.cache_fix_label}` : "";
    console.log(`${f.fit_at}  ${f.model} (${f.speed})  tier=${f.tier}`);
    console.log(
      `  windows=${f.window_count}  R²=${fmt(f.r_squared)}  ` +
        `held-out err=${fmt(f.validation && f.validation.error_pct)}%${label}`,
    );
    console.log(
      "  weights (pp/Mtok): " +
        STORAGE_KEYS.map((k) => `${k}=${fmt(w[k])}`).join("  "),
    );
  }
}

function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function fmt(n) {
  return typeof n === "number" ? String(n) : "n/a";
}

function singlePairOf(windowRows) {
  let key = null;
  for (const r of windowRows) {
    const k = `${r.model}|${r.speed || "standard"}`;
    if (key === null) key = k;
    else if (k !== key) return null;
  }
  return key;
}

function aggregateTokens(windowRows) {
  // Sum raw tokens, then scale to millions so the OLS weights are expressed
  // per-Mtok (matches the AITL fixture's M-scale and the directive's
  // example raw-weights output of order 1e-2…1e+1).
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheCreate = 0;
  for (const r of windowRows) {
    input += r.input_tokens || 0;
    output += r.output_tokens || 0;
    cacheRead += r.cache_read_input_tokens || 0;
    cacheCreate += r.cache_creation_input_tokens || 0;
  }
  const M = 1_000_000;
  return [input / M, output / M, cacheRead / M, cacheCreate / M];
}

function detectCacheFixLabel(rows) {
  if (rows.length === 0) return null;
  let touched = 0;
  for (const r of rows) {
    if ((r.agent_id && r.agent_id !== "") || (r.request_id && r.request_id !== "")) {
      touched++;
    }
  }
  const ratio = touched / rows.length;
  if (ratio >= 0.5) return "cache_fix_active";
  if (ratio < 0.1) return null;
  return "cache_fix_mixed";
}

// -- row mode (legacy) --------------------------------------------------------

function runRowMode(rows) {
  process.stderr.write(DEPRECATION_NOTICE);

  const stable = filterByQuotaWindow(rows);
  const usable = stable.filter(
    (r) => r.q5h_delta !== 0 && r.input_tokens + r.cache_creation_input_tokens + r.cache_read_input_tokens > 0,
  );

  if (usable.length < 10) {
    console.log(`Insufficient data for regression (${usable.length} rows, need at least 10).`);
    console.log("Keep using Claude Code with the interceptor to collect more data points.");
    return;
  }

  const groups = new Map();
  for (const r of usable) {
    const key = `${r.model}|${r.speed || "standard"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  for (const [key, groupRows] of groups) {
    const [model, speed] = key.split("|");
    console.log(`\nModel: ${model} (${speed})`);
    console.log(`Observations: ${groupRows.length}`);

    if (groupRows.length < 10) {
      console.log("  Insufficient data for this model/speed combo (need 10+).");
      continue;
    }

    const n = groupRows.length;
    const X = [];
    const y = [];
    for (const r of groupRows) {
      X.push([r.input_tokens, r.output_tokens, r.cache_read_input_tokens, r.cache_creation_input_tokens]);
      y.push(r.q5h_delta);
    }

    const weights = olsRegression(X, y);
    if (!weights) {
      console.log("  Regression failed (singular matrix).");
      continue;
    }

    const yMean = y.reduce((a, b) => a + b, 0) / n;
    let ssTot = 0;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      const yHat = X[i].reduce((sum, x, j) => sum + x * weights[j], 0);
      ssRes += (y[i] - yHat) ** 2;
      ssTot += (y[i] - yMean) ** 2;
    }
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    const labels = ["Input", "Output", "Cache Read", "Cache Write"];
    const inputWeight = weights[0] || 1;

    console.log(`  R-squared: ${rSquared.toFixed(4)}`);
    console.log(`\n  Relative billing weights (normalized to input = 1.0):`);
    for (let i = 0; i < 4; i++) {
      const relative = weights[i] / inputWeight;
      console.log(`    ${labels[i].padEnd(14)} ${relative.toFixed(3)}`);
    }

    const modelBase = model.replace(/-\d{8}$/, "");
    const knownKey = Object.keys(KNOWN_RATES).find((k) => modelBase.startsWith(k));
    if (knownKey && KNOWN_RATES[knownKey][speed]) {
      const known = KNOWN_RATES[knownKey][speed];
      const knownInput = known.input || 1;
      console.log(`\n  Known API rate ratios (for comparison):`);
      console.log(`    Input          1.000`);
      console.log(`    Output         ${(known.output / knownInput).toFixed(3)}`);
      console.log(`    Cache Read     ${(known.cache_read / knownInput).toFixed(3)}`);
      console.log(`    Cache Write    ${(known.cache_write / knownInput).toFixed(3)}`);
    }

    console.log(`\n  Raw weights (quota fraction per token):`);
    for (let i = 0; i < 4; i++) {
      console.log(`    ${labels[i].padEnd(14)} ${weights[i].toExponential(4)}`);
    }
  }
}

// -- OLS machinery (unchanged from prior implementation) ----------------------

/**
 * Ordinary Least Squares via normal equations: w = (X^T X)^{-1} X^T y
 * X: n×p matrix, y: n×1 vector. Returns p×1 weight vector.
 */
function olsRegression(X, y) {
  const n = X.length;
  const p = X[0].length;

  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < n; k++) {
        XtX[i][j] += X[k][i] * X[k][j];
      }
    }
  }

  const Xty = Array(p).fill(0);
  for (let i = 0; i < p; i++) {
    for (let k = 0; k < n; k++) {
      Xty[i] += X[k][i] * y[k];
    }
  }

  const inv = invertMatrix(XtX);
  if (!inv) return null;

  const w = Array(p).fill(0);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      w[i] += inv[i][j] * Xty[j];
    }
  }

  return w;
}

function invertMatrix(matrix) {
  const n = matrix.length;
  const aug = matrix.map((row, i) => {
    const newRow = [...row];
    for (let j = 0; j < n; j++) {
      newRow.push(i === j ? 1 : 0);
    }
    return newRow;
  });

  for (let col = 0; col < n; col++) {
    let maxVal = Math.abs(aug[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-15) return null;

    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) {
      aug[col][j] /= pivot;
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row.slice(n));
}

// Export the OLS helper for testing — it's a pure function; tests can
// validate weight recovery against the pre-aggregated AITL fixture without
// standing up the full row reader.
export { olsRegression };
