import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ingestCommand } from "../src/cli/ingest.mjs";

async function newTmp() {
  return mkdtemp(join(tmpdir(), "claude-meter-ingest-cli-test-"));
}

function validRow(seq = 0) {
  return {
    v: 1,
    ts: new Date(Date.UTC(2026, 3, 25, 10, 0, seq)).toISOString(),
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
  };
}

test("CLI: ingest --once persists validated rows into the local sink (claude-meter.jsonl)", async () => {
  // Suppress the "ingest --once: ..." console.log to keep test output clean.
  const origLog = console.log;
  console.log = () => {};
  const dir = await newTmp();
  try {
    const source = join(dir, "usage.jsonl");
    const offsetFile = join(dir, ".offset");
    const sink = join(dir, "claude-meter.jsonl");

    // Two valid rows in the proxy source.
    await writeFile(
      source,
      JSON.stringify(validRow(1)) + "\n" + JSON.stringify(validRow(2)) + "\n",
    );

    const result = await ingestCommand({ source, offsetFile, sink, once: true });
    assert.equal(result.processed, 2);
    assert.equal(result.skipped, 0);

    // Sink file must now contain the two rows verbatim, one per line, parseable.
    const text = await readFile(sink, "utf8");
    const lines = text.split("\n").filter(Boolean);
    assert.equal(lines.length, 2, `sink should have 2 rows, got ${lines.length}`);
    for (const line of lines) {
      const row = JSON.parse(line);
      assert.equal(row.v, 1);
      assert.equal(row.sid, "abcdef01");
    }
  } finally {
    console.log = origLog;
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI: ingest --once on missing source warns and exits cleanly", async () => {
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = () => {};
  console.log = () => {};
  const dir = await newTmp();
  try {
    const source = join(dir, "nonexistent.jsonl");
    const offsetFile = join(dir, ".offset");
    const sink = join(dir, "claude-meter.jsonl");
    const result = await ingestCommand({ source, offsetFile, sink, once: true });
    assert.deepEqual(result, { processed: 0, skipped: 0, offset: 0 });
  } finally {
    console.warn = origWarn;
    console.log = origLog;
    await rm(dir, { recursive: true, force: true });
  }
});

test("CLI: ingest persistence dedups across runs via offset file", async () => {
  const origLog = console.log;
  console.log = () => {};
  const dir = await newTmp();
  try {
    const source = join(dir, "usage.jsonl");
    const offsetFile = join(dir, ".offset");
    const sink = join(dir, "claude-meter.jsonl");

    await writeFile(source, JSON.stringify(validRow(1)) + "\n");
    await ingestCommand({ source, offsetFile, sink, once: true });

    // Append a second row.
    const { appendFile } = await import("node:fs/promises");
    await appendFile(source, JSON.stringify(validRow(2)) + "\n");

    const result2 = await ingestCommand({ source, offsetFile, sink, once: true });
    assert.equal(result2.processed, 1, "second run only processes the new row");

    const lines = (await readFile(sink, "utf8")).split("\n").filter(Boolean);
    assert.equal(lines.length, 2, "sink should have 2 rows total (no duplicates)");
  } finally {
    console.log = origLog;
    await rm(dir, { recursive: true, force: true });
  }
});
