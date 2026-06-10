// Tests for the dashboard-dynamic-models directive (PR #27 / commit c11b437).
// Covers the model-display constants in src/rates.mjs PLUS the re-export
// contract on src/constants.mjs, so a future implementation that omits a
// re-export or breaks an invariant fails at CI.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as rates from "../src/rates.mjs";
import * as constants from "../src/constants.mjs";

// ─── MODEL_DISPLAY_ORDER invariants ──────────────────────────────────────

test("MODEL_DISPLAY_ORDER is a non-empty array of strings", () => {
  assert.ok(Array.isArray(rates.MODEL_DISPLAY_ORDER));
  assert.ok(rates.MODEL_DISPLAY_ORDER.length > 0);
  for (const m of rates.MODEL_DISPLAY_ORDER) {
    assert.equal(typeof m, "string");
    assert.ok(m.length > 0);
  }
});

test("every entry in MODEL_DISPLAY_ORDER is a key in KNOWN_RATES", () => {
  for (const m of rates.MODEL_DISPLAY_ORDER) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(rates.KNOWN_RATES, m),
      `MODEL_DISPLAY_ORDER entry "${m}" is not a key in KNOWN_RATES`,
    );
  }
});

test("MODEL_DISPLAY_ORDER has no duplicate entries (uniqueness)", () => {
  const set = new Set(rates.MODEL_DISPLAY_ORDER);
  assert.equal(
    set.size,
    rates.MODEL_DISPLAY_ORDER.length,
    "MODEL_DISPLAY_ORDER contains duplicate entries",
  );
});

// ─── MODEL_BASELINE invariants ───────────────────────────────────────────

test("MODEL_BASELINE is a non-empty string", () => {
  assert.equal(typeof rates.MODEL_BASELINE, "string");
  assert.ok(rates.MODEL_BASELINE.length > 0);
});

test("MODEL_BASELINE is a key in KNOWN_RATES", () => {
  assert.ok(
    Object.prototype.hasOwnProperty.call(rates.KNOWN_RATES, rates.MODEL_BASELINE),
    `MODEL_BASELINE "${rates.MODEL_BASELINE}" is not a key in KNOWN_RATES`,
  );
});

test("MODEL_BASELINE is a key in MODEL_DISPLAY_ORDER (stronger invariant)", () => {
  assert.ok(
    rates.MODEL_DISPLAY_ORDER.includes(rates.MODEL_BASELINE),
    `MODEL_BASELINE "${rates.MODEL_BASELINE}" is not in MODEL_DISPLAY_ORDER — the chart would have a baseline that never renders`,
  );
});

// ─── EDITORIAL_COMPARISON_PAIR invariants ────────────────────────────────

test("EDITORIAL_COMPARISON_PAIR.cheaper and .expensive are both keys in MODEL_DISPLAY_ORDER", () => {
  assert.ok(
    rates.MODEL_DISPLAY_ORDER.includes(rates.EDITORIAL_COMPARISON_PAIR.cheaper),
    `EDITORIAL_COMPARISON_PAIR.cheaper "${rates.EDITORIAL_COMPARISON_PAIR.cheaper}" is not in MODEL_DISPLAY_ORDER`,
  );
  assert.ok(
    rates.MODEL_DISPLAY_ORDER.includes(rates.EDITORIAL_COMPARISON_PAIR.expensive),
    `EDITORIAL_COMPARISON_PAIR.expensive "${rates.EDITORIAL_COMPARISON_PAIR.expensive}" is not in MODEL_DISPLAY_ORDER`,
  );
});

test("EDITORIAL_COMPARISON_PAIR.cheaper !== .expensive (distinctness)", () => {
  assert.notEqual(
    rates.EDITORIAL_COMPARISON_PAIR.cheaper,
    rates.EDITORIAL_COMPARISON_PAIR.expensive,
    "EDITORIAL_COMPARISON_PAIR.cheaper and .expensive point at the same model — the comparison card would compare a model to itself",
  );
});

// ─── Re-export contract (Codex round-1 blocker 1) ────────────────────────

test("src/constants.mjs re-exports KNOWN_RATES referentially-equal to src/rates.mjs", () => {
  assert.equal(
    constants.KNOWN_RATES,
    rates.KNOWN_RATES,
    "src/constants.mjs.KNOWN_RATES is not the same object as src/rates.mjs.KNOWN_RATES — re-export contract broken",
  );
});

test("src/constants.mjs re-exports RATES_LAST_VERIFIED referentially-equal to src/rates.mjs", () => {
  assert.equal(
    constants.RATES_LAST_VERIFIED,
    rates.RATES_LAST_VERIFIED,
    "src/constants.mjs.RATES_LAST_VERIFIED does not match src/rates.mjs",
  );
});

test("src/constants.mjs re-exports RATES_SOURCE_URL referentially-equal to src/rates.mjs", () => {
  assert.equal(
    constants.RATES_SOURCE_URL,
    rates.RATES_SOURCE_URL,
    "src/constants.mjs.RATES_SOURCE_URL does not match src/rates.mjs",
  );
});

test("src/constants.mjs re-exports PLAN_LIST_PRICE_PER_DAY referentially-equal to src/rates.mjs", () => {
  assert.equal(
    constants.PLAN_LIST_PRICE_PER_DAY,
    rates.PLAN_LIST_PRICE_PER_DAY,
    "src/constants.mjs.PLAN_LIST_PRICE_PER_DAY is not the same object as src/rates.mjs.PLAN_LIST_PRICE_PER_DAY — re-export contract broken",
  );
});

// ─── src/rates.mjs is browser-safe (no node: imports) ────────────────────

test("src/rates.mjs has no node:* imports (browser-safe)", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const ratesSource = readFileSync(join(__dirname, "..", "src", "rates.mjs"), "utf8");
  assert.equal(
    /import\s+.*\s+from\s+["']node:/.test(ratesSource),
    false,
    "src/rates.mjs contains a node:* import — would break the Vite browser bundle",
  );
});
