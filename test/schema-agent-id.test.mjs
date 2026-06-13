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

// --- Writer/tailer round-trip preservation (real end-to-end) ---
//
// The directive requires an end-to-end preservation test that writes a
// valid row through the real writer surface (the same `appendFileSync` +
// MeterRowSchema-validation path used by writer.mjs) and reads it back
// through jsonl-tailer.mjs so future refactors cannot silently drop or
// coerce the new fields. Closes Codex r1 #31 B1.

import { appendFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlTailer } from "../src/ingest/jsonl-tailer.mjs";

test("writer/tailer round-trip: agent_id + agent_id_source survive end-to-end", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-id-roundtrip-"));
  const source = join(dir, "usage.jsonl");
  const offsetFile = join(dir, ".claude-meter-ingest-offset");

  try {
    // Construct a row carrying both new fields. Validate via the SAME
    // MeterRowSchema chokepoint that writer.mjs uses (writer.mjs:68).
    const row = validRow({
      agent_id: "wf-leg-roundtrip-a1b2c3d4",
      agent_id_source: "cache_fix_derived",
    });
    const validated = MeterRowSchema.safeParse(row);
    assert.equal(validated.success, true, "row must pass writer-side validation");

    // Append to disk the same way writer.mjs's appendRow() does
    // (writer.mjs:82 — appendFileSync + "\n").
    appendFileSync(source, JSON.stringify(validated.data) + "\n", "utf-8");

    // Read back through the real tailer — which calls
    // MeterRowSchema.parse(...) at jsonl-tailer.mjs:148 — and capture
    // the parsed row via onRow.
    let captured = null;
    const tailer = new JsonlTailer({
      source,
      offsetFile,
      onRow: async (r) => {
        captured = r;
      },
    });
    const result = await tailer.tickOnce();

    // Tailer accepted the row (no skipped=).
    assert.equal(result.processed, 1, "tailer must process the row");
    assert.equal(result.skipped, 0, "tailer must not skip the row");
    assert.ok(result.offset > 0, "tailer must advance offset");

    // Both fields survive unchanged through the writer→file→tailer→onRow
    // path.
    assert.ok(captured, "onRow must have been invoked");
    assert.equal(captured.agent_id, "wf-leg-roundtrip-a1b2c3d4");
    assert.equal(captured.agent_id_source, "cache_fix_derived");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writer/tailer round-trip: row without the new fields (back-compat) processes cleanly", async () => {
  // Regression guard: the .superRefine() wrap doesn't accidentally start
  // rejecting rows from older emitters that don't carry agent_id at all.
  const dir = await mkdtemp(join(tmpdir(), "agent-id-roundtrip-bc-"));
  const source = join(dir, "usage.jsonl");
  const offsetFile = join(dir, ".claude-meter-ingest-offset");

  try {
    const row = validRow();
    const validated = MeterRowSchema.safeParse(row);
    assert.equal(validated.success, true);
    appendFileSync(source, JSON.stringify(validated.data) + "\n", "utf-8");

    const tailer = new JsonlTailer({ source, offsetFile, onRow: async () => {} });
    const result = await tailer.tickOnce();

    assert.equal(result.processed, 1);
    assert.equal(result.skipped, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writer/tailer round-trip: row with agent_id_source but missing agent_id is skipped by tailer (.superRefine enforcement persists through the file boundary)", async () => {
  // The attestation-breach symptom the CHANGELOG documents: a row that
  // bypasses MeterRowSchema validation (e.g. older emitter, hand-crafted
  // bad row) and lands on disk anyway must be REJECTED by the tailer's
  // MeterRowSchema.parse at jsonl-tailer.mjs:148. This proves the
  // skipped= counter operators are told to watch actually fires.
  const dir = await mkdtemp(join(tmpdir(), "agent-id-roundtrip-bad-"));
  const source = join(dir, "usage.jsonl");
  const offsetFile = join(dir, ".claude-meter-ingest-offset");

  try {
    // Hand-craft a row that violates the asymmetric invariant.
    const badRow = { ...validRow(), agent_id_source: "cc_header" };
    // Bypass writer validation entirely — write the bad JSON directly,
    // simulating a misbehaving emitter or a manual JSONL edit.
    await writeFile(source, JSON.stringify(badRow) + "\n", "utf-8");

    const tailer = new JsonlTailer({ source, offsetFile, onRow: async () => {} });
    const result = await tailer.tickOnce();

    // Tailer rejects via .superRefine — nonzero skipped= is the
    // documented attestation-breach symptom.
    assert.equal(result.processed, 0);
    assert.equal(result.skipped, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
