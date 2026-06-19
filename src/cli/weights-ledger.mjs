import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { HISTORY_FILE } from "../constants.mjs";

// Weight-history ledger persistence (Phase 1 of the rates-history-ledger
// directive). Pure functions over the on-disk JSON shape:
//   { schema_version: 1, fits: [ <fit>, ... ] }
// The fits array is append-only; callers never edit or delete entries.

const LEDGER_SCHEMA_VERSION = 1;

/**
 * Read the ledger. Returns { schema_version, fits } — an empty ledger when
 * the file doesn't exist. A missing schema_version is treated as 1 (forward-
 * compat for hand-created files); a schema_version greater than the supported
 * version throws a clear error rather than silently mis-reading a future shape.
 */
export function readLedger(path = HISTORY_FILE) {
  if (!existsSync(path)) return { schema_version: LEDGER_SCHEMA_VERSION, fits: [] };

  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  const version = parsed.schema_version ?? LEDGER_SCHEMA_VERSION;
  if (version > LEDGER_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported ledger schema_version ${version} (this build supports ` +
        `${LEDGER_SCHEMA_VERSION}). Upgrade claude-meter to read this ledger.`,
    );
  }
  return { schema_version: LEDGER_SCHEMA_VERSION, fits: Array.isArray(parsed.fits) ? parsed.fits : [] };
}

/**
 * Append a fit to the ledger and persist it. Reads the current ledger,
 * pushes the new fit onto the end, and writes the whole file back. Returns
 * the updated ledger object.
 */
export function appendFit(path = HISTORY_FILE, fit) {
  const ledger = readLedger(path);
  ledger.fits.push(fit);
  writeFileSync(path, JSON.stringify(ledger, null, 2) + "\n");
  return ledger;
}

/**
 * Filter fits by any combination of tier / model / speed. Returns a new
 * array; does not mutate the input. Omitted filters match everything.
 */
export function filterFits(fits, { tier, model, speed } = {}) {
  return fits.filter(
    (f) =>
      (tier === undefined || f.tier === tier) &&
      (model === undefined || f.model === model) &&
      (speed === undefined || f.speed === speed),
  );
}

// Storage keys, in the canonical display order used by the drift banner.
const DRIFT_WEIGHT_KEYS = ["cache_read", "cache_create", "input", "output"];

/**
 * Compare two fits' weights and report which crossed the drift threshold.
 *
 * Returns { drifted, items } where items is one entry per weight key:
 *   { weight, prev, current, change_pct, crossed_threshold }
 * `drifted` is true iff any item crossed the threshold.
 *
 * A missing prevFit (no prior fit for this (tier, model, speed)) yields
 * { drifted: false, items: [] } — a first fit can't drift from anything.
 *
 * change_pct is relative to the prior weight: (current - prev) / |prev| * 100.
 * When the prior weight is 0, a nonzero current is treated as a crossing
 * (infinite relative change); prev=current=0 is no change.
 */
export function computeDrift(prevFit, currentFit, thresholdPct = 15) {
  if (!prevFit || !prevFit.weights || !currentFit || !currentFit.weights) {
    return { drifted: false, items: [] };
  }

  const items = DRIFT_WEIGHT_KEYS.map((weight) => {
    const prev = prevFit.weights[weight];
    const current = currentFit.weights[weight];
    let changePct;
    if (prev === 0) {
      changePct = current === 0 ? 0 : Infinity;
    } else {
      changePct = ((current - prev) / Math.abs(prev)) * 100;
    }
    return {
      weight,
      prev,
      current,
      change_pct: changePct,
      crossed_threshold: Math.abs(changePct) > thresholdPct,
    };
  });

  return { drifted: items.some((i) => i.crossed_threshold), items };
}
