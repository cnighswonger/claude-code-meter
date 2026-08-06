// Schema coverage for the optional ttl_tier + duration_ms fields.
//
// Directive: docs/directives/usage-row-extended-fields.md (merged in #42).
// Cross-repo contract: claude-code-cache-fix emits these fields when
// CACHE_FIX_USAGE_LOG_EXTENDED=on (default-off). Same three-step rollout
// pattern as agent_id v0.8.0:
//
//   1. directive (#42 merged)
//   2. impl — THIS PR — meter accepts the fields before cache-fix emits
//   3. release — subsequent meter release carries the schema change and
//      becomes the operator-installable prerequisite for the cache-fix gate
//
// Both fields are additive-optional; a row without either still validates
// (back-compat with any cache-fix version predating this feature). Neither
// field participates in a .superRefine() cross-check — unlike agent_id +
// agent_id_source which are paired, ttl_tier and duration_ms are
// independent signals and either may appear without the other.

import { test } from "node:test";
import assert from "node:assert/strict";

import { MeterRowSchema } from "../src/log/schema.mjs";

function validRow(overrides = {}) {
  return {
    v: 1,
    ts: "2026-08-06T18:00:00.000Z",
    sid: "abcdef01",
    model: "claude-opus-4-7",
    speed: "standard",
    service_tier: "standard",
    input_tokens: 100,
    output_tokens: 200,
    cache_creation_input_tokens: 50,
    cache_read_input_tokens: 1000,
    ephemeral_1h_input_tokens: 50,
    ephemeral_5m_input_tokens: 0,
    web_search_requests: 0,
    q5h: 0.5,
    q7d: 0.3,
    q5h_reset: 1700000000,
    q7d_reset: 1700100000,
    qstatus: "allowed",
    qoverage: "allowed",
    qclaim: "five_hour",
    qfallback_pct: 0.5,
    cache_hit_rate: 0.8695652173913043,
    q5h_delta: 0,
    q7d_delta: 0,
    ...overrides,
  };
}

// --- Back-compat ---

test("ttl_tier + duration_ms both absent → row validates (back-compat)", () => {
  const row = validRow();
  assert.equal("ttl_tier" in row, false);
  assert.equal("duration_ms" in row, false);
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

// --- ttl_tier: happy paths + enum discipline ---

test("ttl_tier = \"1h\" → row validates", () => {
  const row = validRow({ ttl_tier: "1h" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

test("ttl_tier = \"5m\" → row validates", () => {
  const row = validRow({ ttl_tier: "5m" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

test("ttl_tier = \"1d\" (not in enum) → row rejected", () => {
  const row = validRow({ ttl_tier: "1d" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("ttl_tier = \"\" (empty string, not in enum) → row rejected", () => {
  const row = validRow({ ttl_tier: "" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("ttl_tier = null (explicit null on optional key) → row rejected (strict)", () => {
  const row = validRow({ ttl_tier: null });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("ttl_tier = 3600 (number, not enum) → row rejected", () => {
  const row = validRow({ ttl_tier: 3600 });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

// --- duration_ms: happy paths + numeric discipline ---

test("duration_ms = 123 → row validates", () => {
  const row = validRow({ duration_ms: 123 });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

test("duration_ms = 0 → row validates (min(0) admits zero)", () => {
  const row = validRow({ duration_ms: 0 });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

test("duration_ms = -1 (below min) → row rejected", () => {
  const row = validRow({ duration_ms: -1 });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("duration_ms = 1.5 (non-integer) → row rejected", () => {
  const row = validRow({ duration_ms: 1.5 });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("duration_ms = \"123\" (string) → row rejected", () => {
  const row = validRow({ duration_ms: "123" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("duration_ms = null (explicit null on optional key) → row rejected (strict)", () => {
  const row = validRow({ duration_ms: null });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

// --- Independent presence (no .superRefine invariant) ---

test("ttl_tier alone (no duration_ms) → row validates", () => {
  const row = validRow({ ttl_tier: "1h" });
  assert.equal("duration_ms" in row, false);
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

test("duration_ms alone (no ttl_tier) → row validates", () => {
  const row = validRow({ duration_ms: 42 });
  assert.equal("ttl_tier" in row, false);
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

test("both present → row validates", () => {
  const row = validRow({ ttl_tier: "1h", duration_ms: 42 });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

// --- Strict-object discipline (unknown keys still rejected) ---

test("valid row + unknown extra key → still rejected (strict object holds)", () => {
  const row = validRow({ ttl_tier: "1h", duration_ms: 42, upstream_status: 200 });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});
