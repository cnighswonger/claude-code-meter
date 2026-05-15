import { test } from "node:test";
import assert from "node:assert/strict";

import { computeStatsAggregate, dedupAnalysisByInstallId } from "../server/stats-aggregate.mjs";

// --- SharePayloadSchema rows (legacy / per-session) ---

test("share row aggregation: model + turn_count → models map by call count", () => {
  const rows = [
    { v: 1, date: "2026-04-20", model: "claude-opus-4-7", turn_count: 50 },
    { v: 1, date: "2026-04-21", model: "claude-opus-4-7", turn_count: 30 },
    { v: 1, date: "2026-04-22", model: "claude-haiku-4-5", turn_count: 100 },
  ];
  const out = computeStatsAggregate(rows);
  assert.equal(out.total_submissions, 3);
  assert.deepEqual(out.submissions_by_type, { share: 3, analysis: 0 });
  assert.equal(out.total_calls, 180);
  assert.equal(out.total_turns, 180); // back-compat alias
  assert.equal(out.total_sessions, 3); // each share row = 1 session
  assert.deepEqual(out.models, { "claude-opus-4-7": 80, "claude-haiku-4-5": 100 });
  assert.equal(out.earliest, "2026-04-20");
  assert.equal(out.latest, "2026-04-22");
});

// --- Analysis rows (current daily push) ---

test("analysis row aggregation: model_splits + n_calls + n_sessions", () => {
  const rows = [
    {
      type: "analysis",
      v: 1,
      generated_at: "2026-04-25T06:37:02.680Z",
      n_calls: 24667,
      n_sessions: 119,
      model_splits: {
        "claude-opus-4-6": { n_calls: 20064, avg_q5h_per_turn: 0.003823 },
        "claude-haiku-4-5": { n_calls: 2328, avg_q5h_per_turn: 0.001065 },
        "claude-sonnet-4-6": { n_calls: 21, avg_q5h_per_turn: 0.001905 },
        "claude-opus-4-7": { n_calls: 2254, avg_q5h_per_turn: 0.004215 },
      },
    },
  ];
  const out = computeStatsAggregate(rows);
  assert.equal(out.total_submissions, 1);
  assert.deepEqual(out.submissions_by_type, { share: 0, analysis: 1 });
  assert.equal(out.total_calls, 24667);
  assert.equal(out.total_turns, 24667);
  assert.equal(out.total_sessions, 119);
  assert.deepEqual(out.models, {
    "claude-opus-4-6": 20064,
    "claude-haiku-4-5": 2328,
    "claude-sonnet-4-6": 21,
    "claude-opus-4-7": 2254,
  });
  assert.equal(out.earliest, "2026-04-25T06:37:02.680Z");
  assert.equal(out.latest, "2026-04-25T06:37:02.680Z");
});

// --- Mixed dataset ---

test("mixed dataset: share + analysis aggregate together by call count", () => {
  const rows = [
    // Share row: 50 calls of opus-4-7.
    { v: 1, date: "2026-04-20", model: "claude-opus-4-7", turn_count: 50 },
    // Analysis: 100 opus-4-7 + 200 haiku-4-5.
    {
      type: "analysis",
      v: 1,
      generated_at: "2026-04-25T06:37:02.680Z",
      n_calls: 300,
      n_sessions: 5,
      model_splits: {
        "claude-opus-4-7": { n_calls: 100 },
        "claude-haiku-4-5": { n_calls: 200 },
      },
    },
  ];
  const out = computeStatsAggregate(rows);
  assert.equal(out.total_submissions, 2);
  assert.deepEqual(out.submissions_by_type, { share: 1, analysis: 1 });
  assert.equal(out.total_calls, 350); // 50 share + 300 analysis
  assert.equal(out.total_sessions, 6); // 1 share + 5 analysis sessions
  assert.deepEqual(out.models, {
    "claude-opus-4-7": 150, // 50 (share) + 100 (analysis)
    "claude-haiku-4-5": 200,
  });
  // Dates: share has date "2026-04-20", analysis has generated_at "2026-04-25...".
  assert.equal(out.earliest, "2026-04-20");
  assert.equal(out.latest, "2026-04-25T06:37:02.680Z");
});

// --- Regression: pre-fix bug shape ---

test("regression: analysis row no longer produces models: { undefined: 1 }", () => {
  // This is the EXACT submission shape that was on the live server pre-fix.
  // Before: stats returned { total_turns: 0, models: { undefined: 1 } }.
  // After: stats returns total_calls=24667 and properly named model keys.
  const rows = [{
    type: "analysis",
    v: 1,
    generated_at: "2026-04-25T06:37:02.680Z",
    install_id: "39b82237b25bbfc7",
    data_range: { start: "2026-04-04T19:05:18.878Z", end: "2026-04-23T11:54:42.136Z" },
    plan_tier: "unknown",
    n_sessions: 119,
    n_calls: 24667,
    model_splits: {
      "claude-opus-4-6": { n_calls: 20064 },
      "claude-haiku-4-5": { n_calls: 2328 },
    },
  }];
  const out = computeStatsAggregate(rows);
  // The "undefined" key from the pre-fix bug must NOT be present.
  assert.equal("undefined" in out.models, false, "pre-fix bug regression: 'undefined' must not be a model key");
  assert.ok(out.total_turns > 0, "total_turns must reflect actual call count");
  assert.equal(out.total_calls, 24667);
});

// --- Edge cases ---

test("empty rows array → zero counts, null dates", () => {
  const out = computeStatsAggregate([]);
  assert.equal(out.total_submissions, 0);
  assert.deepEqual(out.submissions_by_type, { share: 0, analysis: 0 });
  assert.equal(out.total_calls, 0);
  assert.equal(out.total_sessions, 0);
  assert.deepEqual(out.models, {});
  assert.equal(out.earliest, null);
  assert.equal(out.latest, null);
});

test("malformed analysis row missing model_splits → zero models contribution", () => {
  const rows = [{
    type: "analysis",
    v: 1,
    generated_at: "2026-04-25T06:37:02.680Z",
    n_calls: 100,
    n_sessions: 5,
    // model_splits intentionally absent
  }];
  const out = computeStatsAggregate(rows);
  assert.equal(out.total_calls, 100);
  assert.deepEqual(out.models, {});
});

test("share row missing model field → no model bucket created", () => {
  const rows = [{ v: 1, date: "2026-04-20", turn_count: 10 }];
  const out = computeStatsAggregate(rows);
  assert.equal(out.total_calls, 10);
  assert.deepEqual(out.models, {});
});

test("analysis row uses data_range.end as date fallback if no generated_at", () => {
  const rows = [{
    type: "analysis",
    v: 1,
    n_calls: 10,
    n_sessions: 1,
    data_range: { start: "2026-04-01", end: "2026-04-10" },
  }];
  const out = computeStatsAggregate(rows);
  assert.equal(out.earliest, "2026-04-10");
});

test("non-finite numeric fields are coerced to 0 (no NaN propagation)", () => {
  const rows = [
    { v: 1, date: "2026-04-20", model: "x", turn_count: "fifty" }, // non-numeric
    { type: "analysis", v: 1, n_calls: NaN, n_sessions: undefined, model_splits: {} },
  ];
  const out = computeStatsAggregate(rows);
  assert.equal(Number.isFinite(out.total_calls), true);
  assert.equal(out.total_calls, 0);
  assert.equal(out.total_sessions, 1); // 1 share + 0 analysis
});

test("null and non-object rows are tolerated", () => {
  // Defensive: should not throw on pathological inputs even though they
  // shouldn't appear in production (data file is guarded by schema validation
  // at write time).
  const rows = [null, undefined];
  // null is filtered by `r &&` checks; undefined likewise.
  const out = computeStatsAggregate(rows);
  assert.equal(out.total_submissions, 2); // rows.length still 2
  assert.equal(out.total_calls, 0);
});

// --- install_id dedup for analysis rows (issue #13) ---

test("analysis dedup: two cumulative snapshots from same install_id → latest wins", () => {
  // Reproduces the exact symptom from issue #13: two cumulative analysis
  // snapshots from the same install with overlapping date ranges. Pre-fix,
  // totals double-counted the earlier snapshot. Post-fix, only the latest
  // contributes.
  const rows = [
    {
      type: "analysis",
      v: 1,
      install_id: "39b82237b25bbfc7",
      generated_at: "2026-04-30T06:37:00Z",
      data_range: { start: "2026-04-04", end: "2026-04-30" },
      n_calls: 29825,
      n_sessions: 137,
      model_splits: { "claude-opus-4-6": { n_calls: 29825 } },
    },
    {
      type: "analysis",
      v: 1,
      install_id: "39b82237b25bbfc7",
      generated_at: "2026-05-06T06:37:00Z",
      data_range: { start: "2026-04-04", end: "2026-05-06" },
      n_calls: 32102,
      n_sessions: 154,
      model_splits: { "claude-opus-4-6": { n_calls: 32102 } },
    },
  ];
  const out = computeStatsAggregate(rows);
  // total_submissions and submissions_by_type stay RAW (2 rows received) —
  // only the call / session / model rollups reflect the deduped dataset.
  assert.equal(out.total_submissions, 2);
  assert.deepEqual(out.submissions_by_type, { share: 0, analysis: 2 });
  // The pre-fix bug summed both: 61927 calls / 291 sessions. Post-fix, only
  // the latest snapshot (May 6) contributes.
  assert.equal(out.total_calls, 32102);
  assert.equal(out.total_sessions, 154);
  assert.deepEqual(out.models, { "claude-opus-4-6": 32102 });
});

test("dedup is type-scoped: share rows from same install_id are NOT collapsed", () => {
  // Share rows are per-session, non-overlapping. Two share submissions from
  // the same install represent two distinct sessions and must both count.
  const rows = [
    { v: 1, install_id: "abc123", date: "2026-04-20", model: "claude-opus-4-7", turn_count: 50 },
    { v: 1, install_id: "abc123", date: "2026-04-21", model: "claude-opus-4-7", turn_count: 30 },
  ];
  const out = computeStatsAggregate(rows);
  assert.equal(out.total_calls, 80, "share rows must be summed, not collapsed");
  assert.equal(out.total_sessions, 2);
  assert.deepEqual(out.models, { "claude-opus-4-7": 80 });
});

test("dedup selects newest by generated_at, not file insertion order", () => {
  // Verifies dedup is robust to out-of-order writes: even when the LATEST
  // snapshot appears first in the dataset, it must still be selected.
  const rows = [
    // Inserted first but generated SECOND (newest).
    {
      type: "analysis",
      v: 1,
      install_id: "install-X",
      generated_at: "2026-05-10T12:00:00Z",
      n_calls: 999,
      n_sessions: 9,
      model_splits: { "claude-opus-4-6": { n_calls: 999 } },
    },
    // Inserted second but generated FIRST (older).
    {
      type: "analysis",
      v: 1,
      install_id: "install-X",
      generated_at: "2026-05-01T12:00:00Z",
      n_calls: 111,
      n_sessions: 1,
      model_splits: { "claude-opus-4-6": { n_calls: 111 } },
    },
  ];
  const out = computeStatsAggregate(rows);
  // The newer 2026-05-10 snapshot wins, not the last one iterated.
  assert.equal(out.total_calls, 999);
  assert.equal(out.total_sessions, 9);
});

test("dedup: analysis row without install_id passes through (not collapsed with others)", () => {
  // Legacy / malformed analysis rows lacking install_id should not be
  // silently collapsed under a synthetic key. Each contributes independently.
  const rows = [
    { type: "analysis", v: 1, generated_at: "2026-04-25T06:37:00Z", n_calls: 100, n_sessions: 5, model_splits: {} },
    { type: "analysis", v: 1, generated_at: "2026-04-26T06:37:00Z", n_calls: 200, n_sessions: 10, model_splits: {} },
  ];
  const out = computeStatsAggregate(rows);
  assert.equal(out.total_calls, 300);
  assert.equal(out.total_sessions, 15);
});

test("dedup falls back to data_range.end when generated_at is missing", () => {
  // Some older analysis snapshots may lack generated_at; data_range.end is
  // the documented fallback for date ordering in computeStatsAggregate, and
  // dedup uses the same fallback.
  const rows = [
    {
      type: "analysis",
      v: 1,
      install_id: "install-Y",
      data_range: { start: "2026-04-01", end: "2026-04-15" },
      n_calls: 50,
      n_sessions: 2,
      model_splits: {},
    },
    {
      type: "analysis",
      v: 1,
      install_id: "install-Y",
      data_range: { start: "2026-04-01", end: "2026-04-30" },
      n_calls: 100,
      n_sessions: 5,
      model_splits: {},
    },
  ];
  const out = computeStatsAggregate(rows);
  // April 30 supersedes April 15.
  assert.equal(out.total_calls, 100);
  assert.equal(out.total_sessions, 5);
});

test("dedupAnalysisByInstallId helper: directly callable, returns deduped row array", () => {
  // The helper is exported so future consumers can apply the same dedup
  // policy outside computeStatsAggregate (e.g. CSV exports, future analytics).
  const rows = [
    { v: 1, date: "2026-04-20", model: "x", turn_count: 10 }, // share, passthrough
    {
      type: "analysis",
      install_id: "a",
      generated_at: "2026-05-01T00:00:00Z",
      n_calls: 1,
    },
    {
      type: "analysis",
      install_id: "a",
      generated_at: "2026-05-02T00:00:00Z",
      n_calls: 2,
    },
  ];
  const out = dedupAnalysisByInstallId(rows);
  // One share row + one (deduped) analysis row.
  assert.equal(out.length, 2);
  const analysis = out.find((r) => r && r.type === "analysis");
  assert.equal(analysis.n_calls, 2);
});
