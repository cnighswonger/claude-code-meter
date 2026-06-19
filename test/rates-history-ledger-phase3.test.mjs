// Tests for Phase 3 of the rates-history-ledger directive (#34 / PR #36).
// Covers the scheduled-refit cadence gate on the default-mode `rates` path:
// empty ledger, fresh fit (no trigger), stale fit (trigger), tier transition,
// and --skip-scheduled-refit. Subprocess against bin/claude-meter.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger } from "../src/cli/weights-ledger.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLI_ENTRY = join(REPO_ROOT, "bin", "claude-meter.mjs");

// A log producing ≥5 qualifying single-model windows (rank-4 token mix).
function writeFitLog(path) {
  const rows = [];
  const mk = (reset, q5h, in_, out_, cr, cc) => {
    for (let i = 0; i < 25; i++) {
      rows.push({
        ts: "2026-05-25T00:00:00Z",
        model: "claude-opus-4-7",
        speed: "standard",
        input_tokens: in_,
        output_tokens: out_,
        cache_read_input_tokens: cr,
        cache_creation_input_tokens: cc,
        q5h,
        q5h_reset: reset,
        q5h_delta: q5h,
      });
    }
  };
  mk(1000, 0.5, 1000, 1500, 10_000, 1100);
  mk(2000, 0.6, 1500, 1200, 12_000, 1300);
  mk(3000, 0.4, 800, 1800, 8_000, 900);
  mk(4000, 0.7, 1800, 1100, 14_000, 1500);
  mk(5000, 0.55, 1200, 1700, 11_000, 1200);
  mk(6000, 0.65, 1600, 1000, 13_000, 1400);
  mk(99999, 0.3, 600, 1300, 5_000, 700); // in-progress, excluded
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

function writeLedger(path, fits) {
  writeFileSync(path, JSON.stringify({ schema_version: 1, fits }, null, 2) + "\n");
}

function fitAtDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function ledgerFit(fitAt, { tier = "max-20x", tierStarted = "2026-05-23" } = {}) {
  return {
    fit_at: fitAt,
    tier,
    tier_started: tierStarted,
    model: "claude-opus-4-7",
    speed: "standard",
    window_count: 6,
    r_squared: 0.7,
    weights: { input: 8, output: 60, cache_read: 0.025, cache_create: 10 },
    validation: { method: "hold-out-most-recent", error_pct: 2.0 },
    cache_fix_label: null,
  };
}

function runDefaultRates(dir, ledger, extra = []) {
  const log = join(dir, "log.jsonl");
  writeFitLog(log);
  return spawnSync(
    process.execPath,
    [CLI_ENTRY, "rates", "--tier-start-date", "2026-05-23", "--plan", "max-20x", "--log-file", log, "--ledger-file", ledger, ...extra],
    { encoding: "utf-8" },
  );
}

test("cadence: empty ledger triggers an immediate scheduled refit", () => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-"));
  const ledger = join(dir, "history.json");
  try {
    const res = runDefaultRates(dir, ledger);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.match(res.stdout, /Scheduled refit ran \(no prior fit on record\)/);
    // A fit was persisted.
    assert.equal(readLedger(ledger).fits.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cadence: a fit younger than 28 days does NOT trigger", () => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-"));
  const ledger = join(dir, "history.json");
  writeLedger(ledger, [ledgerFit(fitAtDaysAgo(5))]);
  try {
    const res = runDefaultRates(dir, ledger);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.doesNotMatch(res.stdout, /Scheduled refit ran/);
    // Ledger unchanged.
    assert.equal(readLedger(ledger).fits.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cadence: a fit 28+ days old triggers a refit and appends a new entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-"));
  const ledger = join(dir, "history.json");
  writeLedger(ledger, [ledgerFit(fitAtDaysAgo(30))]);
  try {
    const res = runDefaultRates(dir, ledger);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.match(res.stdout, /Scheduled refit ran \(last fit was 30 days ago\)/);
    assert.equal(readLedger(ledger).fits.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cadence: a tier transition triggers immediately and suppresses drift", () => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-"));
  const ledger = join(dir, "history.json");
  // Prior fit is FRESH (won't trip the 28-day window) but under a different
  // tier, so only the transition can trigger. Its weights differ enough that,
  // if drift weren't suppressed, a banner would print.
  writeLedger(ledger, [
    {
      ...ledgerFit(fitAtDaysAgo(2), { tier: "max-5x", tierStarted: "2026-04-01" }),
      weights: { input: 1, output: 1, cache_read: 0.001, cache_create: 0.5 },
    },
  ]);
  try {
    const res = runDefaultRates(dir, ledger);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.match(res.stdout, /Tier transition detected \(was: max-5x @ 2026-04-01, now: max-20x @ 2026-05-23\)/);
    assert.doesNotMatch(res.stdout, /DRIFT DETECTED/);
    // A new fit landed under the new tier.
    const fits = readLedger(ledger).fits;
    assert.equal(fits.length, 2);
    assert.equal(fits[fits.length - 1].tier, "max-20x");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cadence: a drifting scheduled refit prints the drift banner exactly once", () => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-"));
  const ledger = join(dir, "history.json");
  // Stale prior fit, SAME (tier, model, speed), with weights tiny enough that
  // the scheduled refit's recovered weights drift far past 15%. The scheduled
  // refit suppresses its own banner; the downstream pending-banner check must
  // print it once — not zero (suppressed everywhere) and not twice (both
  // paths). This is the load-bearing Phase 2 / Phase 3 interaction.
  writeLedger(ledger, [
    {
      ...ledgerFit(fitAtDaysAgo(40)),
      weights: { input: 1, output: 1, cache_read: 0.001, cache_create: 0.5 },
    },
  ]);
  try {
    const res = runDefaultRates(dir, ledger);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.match(res.stdout, /Scheduled refit ran/);
    const driftCount = (res.stdout.match(/DRIFT DETECTED/g) || []).length;
    assert.equal(driftCount, 1, `drift banner should print exactly once, got ${driftCount}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cadence: --skip-scheduled-refit suppresses the trigger for that invocation", () => {
  const dir = mkdtempSync(join(tmpdir(), "cadence-"));
  const ledger = join(dir, "history.json");
  writeLedger(ledger, [ledgerFit(fitAtDaysAgo(60))]); // very stale
  try {
    const res = runDefaultRates(dir, ledger, ["--skip-scheduled-refit"]);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.doesNotMatch(res.stdout, /Scheduled refit ran/);
    assert.doesNotMatch(res.stdout, /Tier transition detected/);
    // Ledger unchanged despite being stale.
    assert.equal(readLedger(ledger).fits.length, 1);
    // Still produces the normal regression output.
    assert.match(res.stdout, /Model: claude-opus-4-7/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
