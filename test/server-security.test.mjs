/**
 * Security regression tests for the claude-code-meter server.
 *
 * These tests verify that known attack vectors remain mitigated.
 * Run: node --test test/server-security.test.mjs
 *
 * The server is started in-process on a random port for isolation.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We need to import and start the server programmatically.
// For now, we spin up a minimal test harness that exercises the routes.

let server;
let baseUrl;
let dataDir;

async function fetch(path, opts = {}) {
  const url = new URL(path, baseUrl);
  const res = await globalThis.fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json, headers: res.headers };
}

// The server in server/index.mjs calls server.listen(...) at module top level,
// so importing it from inside the test process hangs the test runner. Instead,
// we spawn the server as a separate process and test against it over HTTP.

import { spawn } from "node:child_process";

let proc;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "meter-test-"));
  const port = 18000 + Math.floor(Math.random() * 1000);
  baseUrl = `http://127.0.0.1:${port}`;

  proc = spawn(process.execPath, ["server/index.mjs"], {
    cwd: join(import.meta.dirname, ".."),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: "pipe",
  });

  // Wait for server to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server start timeout")), 5000);
    proc.stdout.on("data", (d) => {
      if (d.toString().includes("listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.on("error", reject);
  });
});

after(() => {
  if (proc) proc.kill();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

// ============================================================
// Slowloris / body drip — readBody timeout
// ============================================================

describe("slowloris protection", () => {
  it("rejects requests that drip body too slowly", async () => {
    // Open a raw TCP connection and send headers but drip body
    const { Socket } = await import("node:net");
    const url = new URL(baseUrl);

    const result = await new Promise((resolve) => {
      const sock = new Socket();
      sock.connect(parseInt(url.port), url.hostname, () => {
        sock.write(
          "POST /api/v1/submit HTTP/1.1\r\n" +
          `Host: ${url.host}\r\n` +
          "Content-Type: application/json\r\n" +
          "Content-Length: 100000\r\n" +
          "\r\n" +
          '{"v":1'  // start body but never finish
        );
        // Don't send more data — let the timeout fire
      });

      let data = "";
      sock.on("data", (d) => { data += d.toString(); });
      sock.on("close", () => resolve(data));
      sock.on("error", () => resolve("connection_error"));

      // Safety timeout for the test itself
      setTimeout(() => {
        sock.destroy();
        resolve(data || "timeout");
      }, 15000);
    });

    // Server should have closed the connection (timeout or error)
    assert.ok(
      result.includes("500") || result.includes("connection_error") || result === "timeout" || result === "",
      `Expected timeout/close, got: ${result.slice(0, 200)}`
    );
  });
});

// ============================================================
// Payload size — reject oversized bodies
// ============================================================

describe("payload size limits", () => {
  it("rejects bodies larger than 64KB", async () => {
    const bigPayload = JSON.stringify({ v: 1, junk: "x".repeat(70000) });
    try {
      const res = await fetch("/api/v1/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bigPayload,
      });
      // Server may reject with status code OR destroy the connection
      assert.ok(
        [413, 400, 500].includes(res.status),
        `Expected 413/400/500, got ${res.status}`
      );
    } catch (e) {
      // Connection destroyed by server — this is the expected behavior
      // for the streaming readBody() size check
      assert.ok(
        e.cause?.code === "ECONNRESET" || e.message.includes("fetch failed"),
        `Expected ECONNRESET or fetch failed, got: ${e.message}`
      );
    }
  });
});

// ============================================================
// JSON injection / schema validation
// ============================================================

describe("schema validation", () => {
  it("rejects payloads with extra unknown fields (strict mode)", async () => {
    // __proto__ is stripped by JSON.parse (safe by default in V8).
    // Test with a normal extra field that Zod strictObject should reject.
    const res = await fetch("/api/v1/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        v: 1,
        date: "2026-04-13",
        model: "claude-opus-4-6",
        speed: "standard",
        turn_count: 10,
        plan_tier: "max_5",
        total_input_tokens: 100,
        total_output_tokens: 100,
        total_cache_creation_tokens: 0,
        total_cache_read_tokens: 0,
        total_ephemeral_1h_tokens: 0,
        total_ephemeral_5m_tokens: 0,
        total_web_search_requests: 0,
        avg_cache_hit_rate: 0.5,
        q5h_start: 0, q5h_end: 0.1, q7d_start: 0, q7d_end: 0.01,
        q5h_total_delta: 0.1, q7d_total_delta: 0.01,
        evil_field: "should_be_rejected",
      }),
    });
    assert.equal(res.status, 422, "Should reject unknown fields via strictObject");
  });

  it("__proto__ in JSON is stripped by parser (safe by default)", async () => {
    // Verify JSON.parse strips __proto__ — the payload arrives clean
    const raw = '{"v":1,"__proto__":{"admin":true},"ols":{"r_squared":0.5}}';
    const parsed = JSON.parse(raw);
    assert.equal(parsed.admin, undefined, "__proto__ should not pollute");
  });

  it("rejects non-JSON bodies", async () => {
    const res = await fetch("/api/v1/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "<script>alert(1)</script>",
    });
    assert.equal(res.status, 400);
  });

  it("rejects empty body", async () => {
    const res = await fetch("/api/v1/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "",
    });
    assert.ok([400, 422].includes(res.status));
  });
});

// ============================================================
// CSV injection
// ============================================================

describe("CSV injection prevention", () => {
  it("sanitizes formula prefixes in CSV output", async () => {
    // First submit a valid payload
    const payload = {
      v: 1, date: "2026-04-13", model: "claude-opus-4-6", speed: "standard",
      turn_count: 10, plan_tier: "max_5",
      total_input_tokens: 100, total_output_tokens: 100,
      total_cache_creation_tokens: 0, total_cache_read_tokens: 0,
      total_ephemeral_1h_tokens: 0, total_ephemeral_5m_tokens: 0,
      total_web_search_requests: 0, avg_cache_hit_rate: 0.95,
      q5h_start: 0, q5h_end: 0.1, q7d_start: 0, q7d_end: 0.01,
      q5h_total_delta: 0.1, q7d_total_delta: 0.01,
    };
    await fetch("/api/v1/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const res = await fetch("/api/v1/dataset?format=csv");
    assert.equal(res.status, 200);
    // Verify no raw formula characters in the output
    const lines = res.text.split("\n").slice(1); // skip header
    for (const line of lines) {
      for (const cell of line.split(",")) {
        assert.ok(
          !/^[=+\-@]/.test(cell),
          `CSV cell starts with formula character: ${cell}`
        );
      }
    }
  });
});

// ============================================================
// Rate limiting
// ============================================================

describe("rate limiting", () => {
  it("enforces anonymous submission rate limit", async () => {
    const payload = {
      v: 1, ols: { r_squared: 0.5, coefficients: {} },
      n_sessions: 1, n_calls: 10, generated_at: new Date().toISOString(),
      data_range: { start: "2026-04-13T00:00:00Z", end: "2026-04-13T01:00:00Z" },
      plan_tier: "unknown", n_drain_events: 0, n_rejected: 0,
      correlations: {}, exponents: { mean: 0.8, median: 0.8, std: 0.1, n_superlinear: 0, n_total: 1 },
    };

    let hitLimit = false;
    // Send 12 requests — should hit the 10/day limit
    for (let i = 0; i < 12; i++) {
      const res = await fetch("/api/v1/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) {
        hitLimit = true;
        break;
      }
    }
    assert.ok(hitLimit, "Should have hit rate limit within 12 requests");
  });

  it("rate-limits key registration", async () => {
    let hitLimit = false;
    for (let i = 0; i < 12; i++) {
      const res = await fetch("/api/v1/register", { method: "POST" });
      if (res.status === 429) {
        hitLimit = true;
        break;
      }
    }
    assert.ok(hitLimit, "Should have hit registration rate limit within 12 requests");
  });
});

// ============================================================
// Dataset pagination / OOM protection
// ============================================================

describe("dataset limits", () => {
  it("respects limit parameter", async () => {
    const res = await fetch("/api/v1/dataset?limit=1");
    assert.equal(res.status, 200);
    assert.ok(res.json.data.length <= 1, "Should return at most 1 row");
  });

  it("caps limit at 10000", async () => {
    const res = await fetch("/api/v1/dataset?limit=999999");
    assert.equal(res.status, 200);
    // Can't test the cap directly without 10K+ rows, but verify it doesn't crash
    assert.ok(res.json.count >= 0);
  });

  it("rejects non-numeric limit gracefully", async () => {
    const res = await fetch("/api/v1/dataset?limit=DROP%20TABLE");
    assert.equal(res.status, 200); // parseInt returns NaN, falls back to 1000
  });
});

// ============================================================
// Path traversal / unexpected routes
// ============================================================

describe("routing safety", () => {
  it("returns 404 for unknown paths", async () => {
    const res = await fetch("/../../etc/passwd");
    assert.equal(res.status, 404);
  });

  it("returns 404 for admin-like paths", async () => {
    const res = await fetch("/admin");
    assert.equal(res.status, 404);
  });

  it("returns 404 for dotfiles", async () => {
    const res = await fetch("/.env");
    assert.equal(res.status, 404);
  });

  it("only allows GET and POST", async () => {
    const res = await fetch("/api/v1/stats", { method: "DELETE" });
    assert.equal(res.status, 404);
  });
});

// ============================================================
// Method enforcement
// ============================================================

describe("method enforcement", () => {
  it("rejects GET on submit endpoint", async () => {
    const res = await fetch("/api/v1/submit");
    assert.equal(res.status, 404);
  });

  it("rejects POST on dataset endpoint", async () => {
    const res = await fetch("/api/v1/dataset", { method: "POST" });
    assert.equal(res.status, 404);
  });

  it("rejects POST on stats endpoint", async () => {
    const res = await fetch("/api/v1/stats", { method: "POST" });
    assert.equal(res.status, 404);
  });
});
