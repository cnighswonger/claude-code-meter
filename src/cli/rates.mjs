import { readAllRows, filterByQuotaWindow } from "../log/reader.mjs";
import { KNOWN_RATES } from "../constants.mjs";

/**
 * Estimate $/MTok rates by token type using OLS regression on quota deltas.
 *
 * Each API call produces (token_counts, quota_delta). Assuming linear billing:
 *   q5h_delta = w1*input + w2*output + w3*cache_read + w4*cache_write + noise
 *
 * OLS normal equations: w = (X^T X)^{-1} X^T y
 */
export function ratesCommand(args) {
  const rows = readAllRows();
  if (rows.length === 0) {
    console.log("No usage data found.");
    return;
  }

  // Filter to stable quota windows and rows with non-zero deltas
  const stable = filterByQuotaWindow(rows);
  const usable = stable.filter(
    (r) => r.q5h_delta !== 0 && r.input_tokens + r.cache_creation_input_tokens + r.cache_read_input_tokens > 0,
  );

  if (usable.length < 10) {
    console.log(`Insufficient data for regression (${usable.length} rows, need at least 10).`);
    console.log("Keep using Claude Code with the interceptor to collect more data points.");
    return;
  }

  // Group by (model, speed) for separate regressions
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

    // Build X matrix (n x 4) and y vector (n x 1)
    // Features: input, output, cache_read, cache_write
    const n = groupRows.length;
    const X = [];
    const y = [];
    for (const r of groupRows) {
      X.push([
        r.input_tokens,
        r.output_tokens,
        r.cache_read_input_tokens,
        r.cache_creation_input_tokens,
      ]);
      y.push(r.q5h_delta);
    }

    const weights = olsRegression(X, y);
    if (!weights) {
      console.log("  Regression failed (singular matrix).");
      continue;
    }

    // Compute R-squared
    const yMean = y.reduce((a, b) => a + b, 0) / n;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
      const yHat = X[i].reduce((sum, x, j) => sum + x * weights[j], 0);
      ssRes += (y[i] - yHat) ** 2;
      ssTot += (y[i] - yMean) ** 2;
    }
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    // Weights are in "quota fraction per token"
    // To get relative ratios, normalize to input weight
    const labels = ["Input", "Output", "Cache Read", "Cache Write"];
    const inputWeight = weights[0] || 1;

    console.log(`  R-squared: ${rSquared.toFixed(4)}`);
    console.log(`\n  Relative billing weights (normalized to input = 1.0):`);
    for (let i = 0; i < 4; i++) {
      const relative = weights[i] / inputWeight;
      console.log(`    ${labels[i].padEnd(14)} ${relative.toFixed(3)}`);
    }

    // Compare to known API rates if available
    const modelBase = model.replace(/-\d{8}$/, ""); // strip date suffix
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

    // Raw weights (quota fraction per token — useful for absolute cost estimation)
    console.log(`\n  Raw weights (quota fraction per token):`);
    for (let i = 0; i < 4; i++) {
      console.log(`    ${labels[i].padEnd(14)} ${weights[i].toExponential(4)}`);
    }
  }
}

/**
 * Ordinary Least Squares via normal equations: w = (X^T X)^{-1} X^T y
 * X: n×p matrix, y: n×1 vector. Returns p×1 weight vector.
 */
function olsRegression(X, y) {
  const n = X.length;
  const p = X[0].length;

  // Compute X^T X (p×p)
  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      for (let k = 0; k < n; k++) {
        XtX[i][j] += X[k][i] * X[k][j];
      }
    }
  }

  // Compute X^T y (p×1)
  const Xty = Array(p).fill(0);
  for (let i = 0; i < p; i++) {
    for (let k = 0; k < n; k++) {
      Xty[i] += X[k][i] * y[k];
    }
  }

  // Invert X^T X using Gauss-Jordan elimination
  const inv = invertMatrix(XtX);
  if (!inv) return null;

  // w = inv(X^T X) * X^T y
  const w = Array(p).fill(0);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      w[i] += inv[i][j] * Xty[j];
    }
  }

  return w;
}

/**
 * Gauss-Jordan matrix inversion for small matrices (4×4).
 */
function invertMatrix(matrix) {
  const n = matrix.length;
  // Create augmented matrix [A|I]
  const aug = matrix.map((row, i) => {
    const newRow = [...row];
    for (let j = 0; j < n; j++) {
      newRow.push(i === j ? 1 : 0);
    }
    return newRow;
  });

  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxVal = Math.abs(aug[col][col]);
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > maxVal) {
        maxVal = Math.abs(aug[row][col]);
        maxRow = row;
      }
    }
    if (maxVal < 1e-15) return null; // Singular

    // Swap rows
    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    // Scale pivot row
    const pivot = aug[col][col];
    for (let j = 0; j < 2 * n; j++) {
      aug[col][j] /= pivot;
    }

    // Eliminate column
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row][col];
      for (let j = 0; j < 2 * n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  // Extract inverse (right half of augmented matrix)
  return aug.map((row) => row.slice(n));
}
