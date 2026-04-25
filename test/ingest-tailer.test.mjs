import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, appendFile, readFile, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JsonlTailer } from "../src/ingest/jsonl-tailer.mjs";

async function newTmp() {
  return mkdtemp(join(tmpdir(), "claude-meter-ingest-test-"));
}

function validRow(seq = 0) {
  // Bare-minimum fields satisfying MeterRowSchema v:1.
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

function makePaths(dir) {
  return {
    source: join(dir, "usage.jsonl"),
    offsetFile: join(dir, ".claude-meter-ingest-offset"),
  };
}

test("1. tailer on missing source returns zeros without error", async () => {
  const dir = await newTmp();
  const { source, offsetFile } = makePaths(dir);
  try {
    const tailer = new JsonlTailer({ source, offsetFile });
    const r = await tailer.tickOnce();
    assert.deepEqual(r, { processed: 0, skipped: 0, offset: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("2. single valid row → processed=1, offset advances", async () => {
  const dir = await newTmp();
  const { source, offsetFile } = makePaths(dir);
  try {
    await writeFile(source, JSON.stringify(validRow(1)) + "\n");
    const tailer = new JsonlTailer({ source, offsetFile });
    const r = await tailer.tickOnce();
    assert.equal(r.processed, 1);
    assert.equal(r.skipped, 0);
    assert.ok(r.offset > 0);
    // Offset persisted.
    const persisted = JSON.parse(await readFile(offsetFile, "utf8"));
    assert.equal(persisted.source, source);
    assert.equal(persisted.offset, r.offset);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("3. multiple rows processed in one tick", async () => {
  const dir = await newTmp();
  const { source, offsetFile } = makePaths(dir);
  try {
    const lines = [validRow(1), validRow(2), validRow(3), validRow(4), validRow(5)]
      .map((r) => JSON.stringify(r))
      .join("\n") + "\n";
    await writeFile(source, lines);
    const tailer = new JsonlTailer({ source, offsetFile });
    const r = await tailer.tickOnce();
    assert.equal(r.processed, 5);
    assert.equal(r.skipped, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("4. trailing partial line preserved across ticks", async () => {
  const dir = await newTmp();
  const { source, offsetFile } = makePaths(dir);
  try {
    const r1Json = JSON.stringify(validRow(1));
    const r2Json = JSON.stringify(validRow(2));
    const r3Json = JSON.stringify(validRow(3));
    // Two complete rows + half of a third (no trailing newline).
    const partial = r3Json.slice(0, 30);
    await writeFile(source, `${r1Json}\n${r2Json}\n${partial}`);

    const tailer = new JsonlTailer({ source, offsetFile });
    const r1 = await tailer.tickOnce();
    assert.equal(r1.processed, 2, "should process the two complete rows only");
    // Offset must NOT include the partial fragment.
    const offsetAfter1 = JSON.parse(await readFile(offsetFile, "utf8")).offset;
    const fsP = await import("node:fs/promises");
    const sizeAfter1 = (await fsP.stat(source)).size;
    assert.ok(offsetAfter1 < sizeAfter1, `offset (${offsetAfter1}) should be less than file size (${sizeAfter1})`);

    // Append the rest of row 3.
    await appendFile(source, r3Json.slice(30) + "\n");
    const r2Tick = await tailer.tickOnce();
    assert.equal(r2Tick.processed, 1, "should now process the completed third row");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("5. invalid row mid-stream is skipped, surrounding rows processed", async () => {
  const dir = await newTmp();
  const { source, offsetFile } = makePaths(dir);
  try {
    const invalidRow = { not: "a meter row" };
    const lines = [
      JSON.stringify(validRow(1)),
      JSON.stringify(invalidRow),
      JSON.stringify(validRow(2)),
    ].join("\n") + "\n";
    await writeFile(source, lines);

    const skipped = [];
    const tailer = new JsonlTailer({
      source,
      offsetFile,
      onSkip: (s) => { skipped.push(s); },
    });
    const r = await tailer.tickOnce();
    assert.equal(r.processed, 2);
    assert.equal(r.skipped, 1);
    assert.equal(skipped.length, 1);
    assert.ok(skipped[0].error);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("6. old proxy 9-field row (no v field) is rejected", async () => {
  const dir = await newTmp();
  const { source, offsetFile } = makePaths(dir);
  try {
    // Old-shape proxy row from before MeterRowSchema alignment.
    const oldRow = {
      timestamp: "2026-04-25T10:00:00Z",
      model: "claude-opus-4-7",
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 50,
      q5h_pct: 25,
      q7d_pct: 5,
      peak_hour: false,
    };
    await writeFile(source, JSON.stringify(oldRow) + "\n");
    const tailer = new JsonlTailer({ source, offsetFile });
    const r = await tailer.tickOnce();
    assert.equal(r.processed, 0);
    assert.equal(r.skipped, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("7. offset persistence — second tick only processes new rows", async () => {
  const dir = await newTmp();
  const { source, offsetFile } = makePaths(dir);
  try {
    await writeFile(source, JSON.stringify(validRow(1)) + "\n");
    const t1 = new JsonlTailer({ source, offsetFile });
    const r1 = await t1.tickOnce();
    assert.equal(r1.processed, 1);

    await appendFile(source, JSON.stringify(validRow(2)) + "\n");
    await appendFile(source, JSON.stringify(validRow(3)) + "\n");

    const t2 = new JsonlTailer({ source, offsetFile });
    const r2 = await t2.tickOnce();
    assert.equal(r2.processed, 2, "expected only the two new rows");
    assert.equal(r2.skipped, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("8. file truncation resets offset to 0 and re-processes", async () => {
  const dir = await newTmp();
  const { source, offsetFile } = makePaths(dir);
  try {
    await writeFile(source, JSON.stringify(validRow(1)) + "\n" + JSON.stringify(validRow(2)) + "\n");
    const t1 = new JsonlTailer({ source, offsetFile });
    const r1 = await t1.tickOnce();
    assert.equal(r1.processed, 2);

    // Truncate to 0 and write fresh content.
    await truncate(source, 0);
    await writeFile(source, JSON.stringify(validRow(3)) + "\n");

    const t2 = new JsonlTailer({ source, offsetFile });
    const r2 = await t2.tickOnce();
    assert.equal(r2.processed, 1, "after truncation, the new content is processed from offset 0");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("9. watch mode picks up appended rows", async () => {
  const dir = await newTmp();
  const { source, offsetFile } = makePaths(dir);
  try {
    await writeFile(source, "");
    const events = [];
    const tailer = new JsonlTailer({
      source,
      offsetFile,
      onRow: (row) => { events.push(row.sid); },
    });

    let processed = 0;
    tailer.startWatch(20, ({ processed: p }) => { processed += p; });
    // Wait briefly for watch to be running.
    await new Promise((r) => setTimeout(r, 30));
    await appendFile(source, JSON.stringify(validRow(1)) + "\n");
    // Let a couple ticks pass.
    await new Promise((r) => setTimeout(r, 100));
    tailer.stopWatch();
    assert.ok(processed >= 1, `expected ≥1 processed via watch, got ${processed}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("10. resetOffset deletes the offset file", async () => {
  const dir = await newTmp();
  const { source, offsetFile } = makePaths(dir);
  try {
    await writeFile(source, JSON.stringify(validRow(1)) + "\n");
    const tailer = new JsonlTailer({ source, offsetFile });
    await tailer.tickOnce();
    // Offset file should exist now.
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(offsetFile), true);
    await tailer.resetOffset();
    assert.equal(existsSync(offsetFile), false);
    // Next tick re-processes from start.
    const r = await tailer.tickOnce();
    assert.equal(r.processed, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
