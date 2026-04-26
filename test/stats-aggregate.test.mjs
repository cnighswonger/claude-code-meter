import { test } from "node:test";
import assert from "node:assert/strict";

import { computeStatsAggregate } from "../server/stats-aggregate.mjs";

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
