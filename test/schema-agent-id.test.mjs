// Schema coverage for the optional agent_id + agent_id_source fields added
// in v0.8.0.
//
// Cross-repo contract: claude-code-cache-fix v4.3.0+ emits these fields
// when CACHE_FIX_USAGE_LOG_AGENT_ID=on (default-off). The proxy derives a
// per-Workflow-leg agent id when CC's canonical x-claude-code-agent-id
// header is absent (Workflow-tool subagents per CC#66761) and tags the
// provenance via agent_id_source.
//
// See src/log/schema.mjs leading comment block for the full design + the
// .superRefine() invariant: agent_id_source ⇒ agent_id (asymmetric).

import { test } from "node:test";
import assert from "node:assert/strict";

import { MeterRowSchema } from "../src/log/schema.mjs";

function validRow(overrides = {}) {
  return {
    v: 1,
    ts: "2026-06-13T18:00:00.000Z",
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

test("agent_id + agent_id_source both absent → row validates (back-compat with v0.7.x emitters)", () => {
  const row = validRow();
  assert.equal("agent_id" in row, false);
  assert.equal("agent_id_source" in row, false);
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

// --- Both present (the canonical happy path) ---

test("agent_id + agent_id_source: cc_header → row validates", () => {
  const row = validRow({ agent_id: "wf-leg-a1b2c3d4e5f60718", agent_id_source: "cc_header" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
  assert.equal(result.data.agent_id, "wf-leg-a1b2c3d4e5f60718");
  assert.equal(result.data.agent_id_source, "cc_header");
});

test("agent_id + agent_id_source: cache_fix_derived → row validates", () => {
  const row = validRow({ agent_id: "deadbeefcafebabe", agent_id_source: "cache_fix_derived" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

// --- Value without source is allowed (intentional) ---

test("agent_id present + agent_id_source absent → row validates (provenance recoverable from sid+request_id)", () => {
  const row = validRow({ agent_id: "some-canonical-id-without-source" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

// --- Source without value FAILS (.superRefine() asymmetric invariant) ---

test(".superRefine: agent_id_source 'cc_header' + agent_id absent → row REJECTED", () => {
  const row = validRow({ agent_id_source: "cc_header" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
  // The custom issue should point at agent_id.
  const issue = result.error.issues.find((i) => i.path?.[0] === "agent_id");
  assert.ok(issue, "expected an issue on agent_id");
  assert.match(issue.message, /agent_id is required/);
});

test(".superRefine: agent_id_source 'cache_fix_derived' + agent_id absent → row REJECTED", () => {
  const row = validRow({ agent_id_source: "cache_fix_derived" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

// --- Enum casing — snake_case required, kebab-case rejected ---

test("agent_id_source: 'cc-header' (kebab-case) → row REJECTED (snake_case wire contract)", () => {
  const row = validRow({ agent_id: "wf-leg-id", agent_id_source: "cc-header" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("agent_id_source: 'cache-fix-derived' (kebab-case) → row REJECTED", () => {
  const row = validRow({ agent_id: "wf-leg-id", agent_id_source: "cache-fix-derived" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("agent_id_source: unknown enum value → row REJECTED", () => {
  const row = validRow({ agent_id: "wf-leg-id", agent_id_source: "dashboard_manual" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

// --- agent_id length boundary (mirror request_id) ---

test("agent_id at 64-char boundary → row validates", () => {
  const id64 = "a".repeat(64);
  const row = validRow({ agent_id: id64, agent_id_source: "cc_header" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

test("agent_id at 65-char string → row REJECTED (max(64) tripwire)", () => {
  const id65 = "a".repeat(65);
  const row = validRow({ agent_id: id65, agent_id_source: "cc_header" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("agent_id at 1-char minimum → row validates (no min enforced)", () => {
  const row = validRow({ agent_id: "x", agent_id_source: "cc_header" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

// --- agent_id type rejection ---

test("agent_id non-string value (number) → row REJECTED", () => {
  const row = validRow({ agent_id: 123, agent_id_source: "cc_header" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("agent_id non-string value (null) → row REJECTED", () => {
  const row = validRow({ agent_id: null, agent_id_source: "cc_header" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("agent_id non-string value (object) → row REJECTED", () => {
  const row = validRow({ agent_id: { id: "x" }, agent_id_source: "cc_header" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("agent_id non-string value (array) → row REJECTED", () => {
  const row = validRow({ agent_id: ["x"], agent_id_source: "cc_header" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

test("agent_id non-string value (boolean) → row REJECTED", () => {
  const row = validRow({ agent_id: true, agent_id_source: "cc_header" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

// --- Strictness preserved through the .superRefine() wrap ---

test("unknown sibling key still rejects (z.strictObject preserved through .superRefine() wrap)", () => {
  const row = validRow({ agent_id: "wf-leg-id", agent_id_source: "cc_header", garbage_field: "x" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, false);
});

// --- request_id rollout regression (v0.7.0) ---

test("request_id rollout: row with request_id only still validates (v0.7.0 back-compat)", () => {
  const row = validRow({ request_id: "req_abc123" });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

test("request_id + agent_id pair: both present together → row validates", () => {
  const row = validRow({
    request_id: "req_abc123",
    agent_id: "wf-leg-deadbeef",
    agent_id_source: "cache_fix_derived",
  });
  const result = MeterRowSchema.safeParse(row);
  assert.equal(result.success, true);
});

// --- Round-trip preservation (write → parse) ---

test("round-trip: row carrying agent_id + agent_id_source survives parse unchanged", () => {
  // Note: end-to-end via writer.mjs would also create the file on disk; this
  // test asserts the field-level preservation through MeterRowSchema, which
  // is the validation chokepoint both writer.mjs and jsonl-tailer.mjs use.
  const row = validRow({
    agent_id: "wf-leg-roundtrip",
    agent_id_source: "cache_fix_derived",
  });
  const serialized = JSON.stringify(row);
  const parsedBack = JSON.parse(serialized);
  const result = MeterRowSchema.safeParse(parsedBack);
  assert.equal(result.success, true);
  assert.equal(result.data.agent_id, "wf-leg-roundtrip");
  assert.equal(result.data.agent_id_source, "cache_fix_derived");
});
