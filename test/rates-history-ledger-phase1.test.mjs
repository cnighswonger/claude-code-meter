// Tests for Phase 1 of the rates-history-ledger directive (#34 / PR #36).
// Covers the weights-ledger module (readLedger / appendFit / filterFits) and
// the `rates --refit` / `rates --history` CLI surfaces via subprocess against
// bin/claude-meter.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { readLedger, appendFit, filterFits } from "../src/cli/weights-ledger.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const CLI_ENTRY = join(REPO_ROOT, "bin", "claude-meter.mjs");

// ─── ledger module unit tests ────────────────────────────────────────────

test("readLedger returns an empty ledger when the file does not exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  try {
    const ledger = readLedger(join(dir, "nope.json"));
    assert.deepEqual(ledger, { schema_version: 1, fits: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readLedger returns the existing file's contents", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  const path = join(dir, "history.json");
  const fit = { fit_at: "2026-06-19T00:00:00Z", tier: "max-20x", model: "claude-opus-4-7", speed: "standard" };
  writeFileSync(path, JSON.stringify({ schema_version: 1, fits: [fit] }));
  try {
    const ledger = readLedger(path);
    assert.equal(ledger.fits.length, 1);
    assert.deepEqual(ledger.fits[0], fit);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appendFit adds an entry to a fresh ledger and persists it", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  const path = join(dir, "history.json");
  try {
    appendFit(path, { fit_at: "2026-06-19T01:00:00Z", tier: "max-20x", model: "m", speed: "standard" });
    const onDisk = JSON.parse(readFileSync(path, "utf-8"));
    assert.equal(onDisk.schema_version, 1);
    assert.equal(onDisk.fits.length, 1);
    assert.equal(onDisk.fits[0].fit_at, "2026-06-19T01:00:00Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("appendFit preserves existing entries when adding to a populated ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  const path = join(dir, "history.json");
  try {
    appendFit(path, { fit_at: "2026-06-19T01:00:00Z", tier: "max-20x", model: "m", speed: "standard" });
    appendFit(path, { fit_at: "2026-06-19T02:00:00Z", tier: "max-20x", model: "m", speed: "standard" });
    const ledger = readLedger(path);
    assert.equal(ledger.fits.length, 2);
    assert.equal(ledger.fits[0].fit_at, "2026-06-19T01:00:00Z");
    assert.equal(ledger.fits[1].fit_at, "2026-06-19T02:00:00Z");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("filterFits returns only matching entries on multi-tier history", () => {
  const fits = [
    { tier: "max-20x", model: "opus", speed: "standard" },
    { tier: "max-5x", model: "opus", speed: "standard" },
    { tier: "max-20x", model: "sonnet", speed: "standard" },
  ];
  assert.equal(filterFits(fits, { tier: "max-20x" }).length, 2);
  assert.equal(filterFits(fits, { tier: "max-20x", model: "sonnet" }).length, 1);
  assert.equal(filterFits(fits, {}).length, 3);
  assert.equal(filterFits(fits, { tier: "pro" }).length, 0);
});

test("readLedger treats missing schema_version as 1 and rejects future versions", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  try {
    const noVersion = join(dir, "noversion.json");
    writeFileSync(noVersion, JSON.stringify({ fits: [{ tier: "max-20x" }] }));
    const ledger = readLedger(noVersion);
    assert.equal(ledger.schema_version, 1);
    assert.equal(ledger.fits.length, 1);

    const future = join(dir, "future.json");
    writeFileSync(future, JSON.stringify({ schema_version: 999, fits: [] }));
    assert.throws(() => readLedger(future), /999/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── CLI subprocess tests ────────────────────────────────────────────────

function makeRow({ q5h_reset, q5h, input, output, cache_read, cache_create, model = "claude-opus-4-7", speed = "standard", ts = "2026-05-25T00:00:00Z" }) {
  return {
    ts,
    model,
    speed,
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cache_read,
    cache_creation_input_tokens: cache_create,
    q5h,
    q5h_reset,
    q5h_delta: q5h,
  };
}

// Build a log with enough qualifying single-model windows (≥2, rank-4 token
// mix) to produce a real fit, plus one in-progress window that gets excluded.
function writeFitLog(path) {
  const rows = [];
  const mk = (reset, q5h, in_, out_, cr, cc) => {
    for (let i = 0; i < 25; i++) {
      rows.push(makeRow({ q5h_reset: reset, q5h, input: in_, output: out_, cache_read: cr, cache_create: cc }));
    }
  };
  // 6 qualifying windows → 5 fit observations for 4 params (overdetermined),
  // varied token mixes so the design matrix has rank 4.
  mk(1000, 0.5, 1000, 1500, 10_000, 1100);
  mk(2000, 0.6, 1500, 1200, 12_000, 1300);
  mk(3000, 0.4, 800, 1800, 8_000, 900);
  mk(4000, 0.7, 1800, 1100, 14_000, 1500);
  mk(5000, 0.55, 1200, 1700, 11_000, 1200);
  mk(6000, 0.65, 1600, 1000, 13_000, 1400);
  mk(99999, 0.3, 600, 1300, 5_000, 700); // in-progress, excluded
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}

test("CLI: --refit appends a fit and prints the summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  const log = join(dir, "log.jsonl");
  const ledger = join(dir, "history.json");
  writeFitLog(log);
  try {
    const res = spawnSync(
      process.execPath,
      [CLI_ENTRY, "rates", "--refit", "--tier-start-date", "2026-05-23", "--plan", "max-20x", "--log-file", log, "--ledger-file", ledger],
      { encoding: "utf-8" },
    );
    assert.equal(res.status, 0, `exit should be 0 (stderr: ${res.stderr})`);
    assert.match(res.stdout, /Recorded 1 fit to the weight history ledger/);

    const onDisk = readLedger(ledger);
    assert.equal(onDisk.fits.length, 1);
    const fit = onDisk.fits[0];
    assert.equal(fit.tier, "max-20x");
    assert.equal(fit.model, "claude-opus-4-7");
    assert.equal(fit.speed, "standard");
    assert.equal(fit.tier_started, "2026-05-23");
    assert.ok(typeof fit.r_squared === "number");
    // Pin the full storage-key contract: the ledger must use the SI-style
    // short keys, not the JSONL row-field names or the display labels.
    assert.deepEqual(Object.keys(fit.weights).sort(), ["cache_create", "cache_read", "input", "output"]);
    for (const k of ["input", "output", "cache_read", "cache_create"]) {
      assert.equal(typeof fit.weights[k], "number", `weights.${k} should be numeric`);
    }
    assert.equal(fit.validation.method, "hold-out-most-recent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: --refit with an unsupported --plan value exits non-zero before writing the ledger", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  const log = join(dir, "log.jsonl");
  const ledger = join(dir, "history.json");
  writeFitLog(log);
  try {
    const res = spawnSync(
      process.execPath,
      [CLI_ENTRY, "rates", "--refit", "--tier-start-date", "2026-05-23", "--plan", "banana", "--log-file", log, "--ledger-file", ledger],
      { encoding: "utf-8" },
    );
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /Invalid --plan value: "banana"/);
    // Nothing should have been persisted under the junk tier.
    assert.equal(existsSync(ledger), false, "ledger must not be created on an invalid --plan");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: --refit without --plan exits non-zero with a clear error", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  const log = join(dir, "log.jsonl");
  writeFitLog(log);
  try {
    const res = spawnSync(
      process.execPath,
      [CLI_ENTRY, "rates", "--refit", "--tier-start-date", "2026-05-23", "--log-file", log],
      { encoding: "utf-8" },
    );
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /--plan .* is required for --refit/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI: --history prints entries in reverse-chronological order", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  const ledger = join(dir, "history.json");
  // Two fits, older first on disk; --history should print newest first.
  appendFit(ledger, {
    fit_at: "2026-06-18T00:00:00Z",
    tier: "max-20x",
    model: "claude-opus-4-7",
    speed: "standard",
    window_count: 3,
    r_squared: 0.71,
    weights: { input: 8, output: 60, cache_read: 0.025, cache_create: 10 },
    validation: { method: "hold-out-most-recent", error_pct: 2.3 },
    cache_fix_label: "cache_fix_mixed",
  });
  appendFit(ledger, {
    fit_at: "2026-06-19T00:00:00Z",
    tier: "max-20x",
    model: "claude-opus-4-7",
    speed: "standard",
    window_count: 4,
    r_squared: 0.74,
    weights: { input: 8.2, output: 61, cache_read: 0.026, cache_create: 10.1 },
    validation: { method: "hold-out-most-recent", error_pct: 1.9 },
    cache_fix_label: "cache_fix_mixed",
  });
  try {
    const res = spawnSync(process.execPath, [CLI_ENTRY, "rates", "--history", "--ledger-file", ledger], {
      encoding: "utf-8",
    });
    assert.equal(res.status, 0, `exit should be 0 (stderr: ${res.stderr})`);
    const idxNewer = res.stdout.indexOf("2026-06-19T00:00:00Z");
    const idxOlder = res.stdout.indexOf("2026-06-18T00:00:00Z");
    assert.ok(idxNewer >= 0 && idxOlder >= 0, "both entries should print");
    assert.ok(idxNewer < idxOlder, "newer entry should appear before older");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
