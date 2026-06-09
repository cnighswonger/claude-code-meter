// Schema coverage for the optional request_id field added in v0.7.0.
//
// Cross-repo contract: claude-code-cache-fix v4.1.0+ emits this field on
// MeterRowSchema v:1 rows when CACHE_FIX_USAGE_LOG_REQID=on (default-off
// in cache-fix v4.1.0; default-on as of cache-fix v4.2.0). The field is
// the post-hoc join key against CC's per-session JSONL transcripts at
// ~/.claude/projects/<project>/<session-uuid>.jsonl.

import { test } from "node:test";
import assert from "node:assert/strict";

import { MeterRowSchema } from "../src/log/schema.mjs";

function validRow(overrides = {}) {
  return {
    v: 1,
    ts: "2026-06-09T21:00:00.000Z",
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

// --- Back-compat: rows without request_id still validate ---

test("request_id absent → row still validates (back-compat)", () => {
  const row = validRow();
  // Verify request_id is genuinely absent, not undefined-valued
  assert.equal("request_id" in row, false);
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true,
    `back-compat row must validate: ${JSON.stringify(result.error?.issues)}`);
});

// --- New field accepted ---

test("request_id present + valid → row validates", () => {
  const row = validRow({ request_id: "req_011CbQL6e8qVERUXKwYqUMMi" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true,
    `row with request_id must validate: ${JSON.stringify(result.error?.issues)}`);
  assert.equal(result.data.request_id, "req_011CbQL6e8qVERUXKwYqUMMi");
});

test("request_id at 64-char boundary → row validates", () => {
  const row = validRow({ request_id: "a".repeat(64) });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

test("request_id at 1-char minimum → row validates (no min length enforced)", () => {
  // The cross-repo contract only enforces max(64). Cache-fix's emission
  // path filters empty strings out at the producer side; meter doesn't
  // re-enforce minimum length, leaving room for future format changes
  // (e.g., 6-char short ids if Anthropic ever ships them).
  const row = validRow({ request_id: "r" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

// --- Schema rejects malformed request_id values ---

test("request_id 65-char string → row REJECTED (max(64) tripwire)", () => {
  const row = validRow({ request_id: "a".repeat(65) });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
  assert.ok(
    result.error.issues.some(i => i.path[0] === "request_id"),
    "expected an issue on request_id path",
  );
});

test("request_id non-string value → row REJECTED", () => {
  for (const bad of [123, null, true, ["x"], { x: 1 }]) {
    const row = validRow({ request_id: bad });
    const result = MeterRowSchema.safeParse(row);
    assert.equal(result.success, false,
      `non-string ${typeof bad} (${JSON.stringify(bad)}) must reject`);
  }
});

// --- Strict-object behavior preserved ---

test("unknown sibling key still rejects (strict-object preserved)", () => {
  const row = validRow({
    request_id: "req_011CbQL6e8qVERUXKwYqUMMi",
    fictitious_future_field: "should reject",
  });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
  assert.ok(
    result.error.issues.some(i => i.code === "unrecognized_keys"),
    "expected unrecognized_keys error for fictitious_future_field",
  );
});
