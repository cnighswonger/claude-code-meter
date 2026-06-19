// Tests for Phase 2 of the rates-history-ledger directive (#34 / PR #36).
// Covers computeDrift() and the drift-banner / dismiss surfaces via subprocess
// against bin/claude-meter.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { computeDrift } from "../src/cli/weights-ledger.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLI_ENTRY = join(REPO_ROOT, "bin", "claude-meter.mjs");

const W = (input, output, cache_read, cache_create) => ({ input, output, cache_read, cache_create });

// ─── computeDrift unit tests ─────────────────────────────────────────────

test("computeDrift: drifted=false when all weights are within threshold", () => {
  const prev = { weights: W(8.0, 60.0, 0.025, 10.0) };
  const cur = { weights: W(8.5, 62.0, 0.026, 10.5) }; // all < 15%
  const d = computeDrift(prev, cur);
  assert.equal(d.drifted, false);
  assert.equal(d.items.length, 4);
  assert.ok(d.items.every((i) => i.crossed_threshold === false));
});

test("computeDrift: drifted=true and flags the specific weight that crossed", () => {
  const prev = { weights: W(8.0, 60.0, 0.025, 10.0) };
  const cur = { weights: W(8.1, 59.0, 0.026, 13.5) }; // cache_create +35%
  const d = computeDrift(prev, cur);
  assert.equal(d.drifted, true);
  const crossed = d.items.filter((i) => i.crossed_threshold).map((i) => i.weight);
  assert.deepEqual(crossed, ["cache_create"]);
  const cc = d.items.find((i) => i.weight === "cache_create");
  assert.ok(Math.abs(cc.change_pct - 35) < 0.01);
});

test("computeDrift: missing prior fit returns drifted=false (first fit can't drift)", () => {
  const cur = { weights: W(8.0, 60.0, 0.025, 10.0) };
  const d = computeDrift(null, cur);
  assert.equal(d.drifted, false);
  assert.deepEqual(d.items, []);
});

// ─── CLI subprocess tests ────────────────────────────────────────────────

// A log producing ≥5 qualifying single-model windows (rank-4 token mix) so
// --refit yields a real fit. Reused across the drift subprocess tests.
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

// Seed a ledger with one prior fit whose weights differ enough from the fit
// the log will produce that drift is guaranteed. The log's real fit has a
// large cache_create weight; seed a tiny one so the relative change is huge.
function seedPriorFit(ledgerPath, fitAt) {
  writeFileSync(
    ledgerPath,
    JSON.stringify({
      schema_version: 1,
      fits: [
        {
          fit_at: fitAt,
          tier: "max-20x",
          model: "claude-opus-4-7",
          speed: "standard",
          window_count: 6,
          r_squared: 0.7,
          weights: W(1.0, 1.0, 0.001, 0.5),
          validation: { method: "hold-out-most-recent", error_pct: 2.0 },
          cache_fix_label: null,
        },
      ],
    }),
  );
}

test("CLI: --refit after a drift-inducing change prints the drift banner", () => {
  const dir = mkdtempSync(join(tmpdir(), "drift-"));
  const log = join(dir, "log.jsonl");
  const ledger = join(dir, "history.json");
  writeFitLog(log);
  seedPriorFit(ledger, "2026-06-01T00:00:00Z");
  try {
    const res = spawnSync(
      process.execPath,
      [CLI_ENTRY, "rates", "--refit", "--tier-start-date", "2026-05-23", "--plan", "max-20x", "--log-file", log, "--ledger-file", ledger],
      { encoding: "utf-8" },
    );
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.match(res.stdout, /DRIFT DETECTED/);
    assert.match(res.stdout, /⚠/);
    // Pin the directive's exact hard-coded summary sentence ("last month",
    // not "last period" or any paraphrase).
    assert.match(res.stdout, /Workloads that were quota-efficient last month may now burn faster\./);
    // Header shows the prior fit's date only, not the full ISO timestamp.
    assert.match(res.stdout, /since last fit \(2026-06-01\):/);
    assert.doesNotMatch(res.stdout, /since last fit \(2026-06-01T00:00:00Z\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: subsequent default rates prints the drift banner above the regression output", () => {
  const dir = mkdtempSync(join(tmpdir(), "drift-"));
  const log = join(dir, "log.jsonl");
  const ledger = join(dir, "history.json");
  const seen = join(dir, "drift-seen");
  writeFitLog(log);
  seedPriorFit(ledger, "2026-06-01T00:00:00Z");
  try {
    // Refit to append the drifting current fit.
    spawnSync(
      process.execPath,
      [CLI_ENTRY, "rates", "--refit", "--tier-start-date", "2026-05-23", "--plan", "max-20x", "--log-file", log, "--ledger-file", ledger],
      { encoding: "utf-8" },
    );
    // Default-mode rates: banner should appear before the Model line.
    const res = spawnSync(
      process.execPath,
      [CLI_ENTRY, "rates", "--tier-start-date", "2026-05-23", "--log-file", log, "--ledger-file", ledger, "--drift-seen-file", seen],
      { encoding: "utf-8" },
    );
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    const driftIdx = res.stdout.indexOf("DRIFT DETECTED");
    const modelIdx = res.stdout.indexOf("Model:");
    assert.ok(driftIdx >= 0, "banner should print");
    assert.ok(modelIdx >= 0, "regression output should print");
    assert.ok(driftIdx < modelIdx, "banner should appear above the regression output");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: --dismiss-drift suppresses the banner until the next drift event", () => {
  const dir = mkdtempSync(join(tmpdir(), "drift-"));
  const log = join(dir, "log.jsonl");
  const ledger = join(dir, "history.json");
  const seen = join(dir, "drift-seen");
  writeFitLog(log);
  seedPriorFit(ledger, "2026-06-01T00:00:00Z");
  try {
    spawnSync(
      process.execPath,
      [CLI_ENTRY, "rates", "--refit", "--tier-start-date", "2026-05-23", "--plan", "max-20x", "--log-file", log, "--ledger-file", ledger],
      { encoding: "utf-8" },
    );
    // Dismiss.
    const dismiss = spawnSync(
      process.execPath,
      [CLI_ENTRY, "rates", "--dismiss-drift", "--ledger-file", ledger, "--drift-seen-file", seen],
      { encoding: "utf-8" },
    );
    assert.equal(dismiss.status, 0, `stderr: ${dismiss.stderr}`);
    assert.ok(existsSync(seen), "drift-seen dotfile should be written");

    // Subsequent default rates: banner suppressed.
    const res = spawnSync(
      process.execPath,
      [CLI_ENTRY, "rates", "--tier-start-date", "2026-05-23", "--log-file", log, "--ledger-file", ledger, "--drift-seen-file", seen],
      { encoding: "utf-8" },
    );
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.doesNotMatch(res.stdout, /DRIFT DETECTED/);
    // The dotfile holds the dismissed fit's timestamp.
    assert.match(readFileSync(seen, "utf-8").trim(), /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Write a ledger with explicit fits — used by the coverage tests below that
// need precise control over fit_at and weights to construct drift / non-drift
// sequences without round-tripping through the regression.
function writeLedger(path, fits) {
  writeFileSync(path, JSON.stringify({ schema_version: 1, fits }, null, 2) + "\n");
}

function ledgerFit(fitAt, weights) {
  return {
    fit_at: fitAt,
    tier: "max-20x",
    model: "claude-opus-4-7",
    speed: "standard",
    window_count: 30,
    r_squared: 0.73,
    weights,
    validation: { method: "hold-out-most-recent", error_pct: 2.0 },
    cache_fix_label: null,
  };
}

// Runs default-mode rates against a fixture log; the regression output itself
// is irrelevant here — we only assert on the drift banner.
function runDefaultRates(dir, ledger, seen) {
  const log = join(dir, "log.jsonl");
  if (!existsSync(log)) writeFitLog(log);
  return spawnSync(
    process.execPath,
    [CLI_ENTRY, "rates", "--tier-start-date", "2026-05-23", "--log-file", log, "--ledger-file", ledger, "--drift-seen-file", seen],
    { encoding: "utf-8" },
  );
}

test("CLI: a non-drift most-recent fit shows no banner even with a stale seen-file (step 3 short-circuits before the dotfile)", () => {
  const dir = mkdtempSync(join(tmpdir(), "drift-"));
  const ledger = join(dir, "history.json");
  const seen = join(dir, "drift-seen");
  // Prior + current are within threshold → no drift. The seen-file holds an
  // OLD unrelated timestamp; the banner must still not appear, proving the
  // drifted===false short-circuit runs before the dotfile is consulted.
  writeLedger(ledger, [
    ledgerFit("2026-06-01T00:00:00Z", W(8.0, 60.0, 0.025, 10.0)),
    ledgerFit("2026-06-10T00:00:00Z", W(8.2, 61.0, 0.026, 10.4)), // all < 15%
  ]);
  writeFileSync(seen, "1999-01-01T00:00:00Z\n"); // stale, never matches
  try {
    const res = runDefaultRates(dir, ledger, seen);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    assert.doesNotMatch(res.stdout, /DRIFT DETECTED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: a fresh later drift event re-shows the banner after a prior dismiss", () => {
  const dir = mkdtempSync(join(tmpdir(), "drift-"));
  const ledger = join(dir, "history.json");
  const seen = join(dir, "drift-seen");
  // Two drift events. The operator dismissed the FIRST (seen-file holds its
  // fit_at). A newer drifting fit with a different fit_at must re-show.
  const firstDrift = "2026-06-10T00:00:00Z";
  const secondDrift = "2026-06-19T00:00:00Z";
  writeLedger(ledger, [
    ledgerFit("2026-06-01T00:00:00Z", W(8.0, 60.0, 0.025, 10.0)),
    ledgerFit(firstDrift, W(8.0, 60.0, 0.025, 13.0)), // +30% cache_create
    ledgerFit(secondDrift, W(8.0, 60.0, 0.025, 17.0)), // +30% again vs firstDrift
  ]);
  // Operator dismissed the first drift event, not the second.
  writeFileSync(seen, firstDrift + "\n");
  try {
    const res = runDefaultRates(dir, ledger, seen);
    assert.equal(res.status, 0, `stderr: ${res.stderr}`);
    // Most-recent fit (secondDrift) drifts from firstDrift and is NOT the
    // dismissed event → banner re-shows.
    assert.match(res.stdout, /DRIFT DETECTED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
