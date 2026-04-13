/**
 * claude-meter community API server.
 *
 * Receives anonymized usage session summaries, validates strictly,
 * and stores in append-only JSONL. Public dataset access.
 *
 * Routes:
 *   POST /api/v1/submit     — Submit a share payload (requires API key)
 *   GET  /api/v1/dataset    — Download anonymized dataset (JSON or CSV)
 *   GET  /api/v1/stats      — Aggregate statistics
 *   GET  /api/v1/schema     — Current accepted schema
 *   POST /api/v1/register   — Generate a write API key
 *
 * Deploy: node server/index.mjs
 * Config via env: PORT (default 3847), DATA_DIR (default ./data)
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(__dirname, "..", "public");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const PORT = parseInt(process.env.PORT || "3847");
const DATA_DIR = process.env.DATA_DIR || "./data";
const KEYS_FILE = join(DATA_DIR, "api-keys.json");

// Rate limiting: per-IP sliding window
const RATE_LIMIT_ANON = { max: 10, windowMs: 86400000 };  // 10/day anonymous
const RATE_LIMIT_KEYED = { max: 100, windowMs: 86400000 }; // 100/day with API key
const rateBuckets = new Map(); // ip -> { count, resetAt }

function checkRateLimit(ip, hasKey) {
  const limit = hasKey ? RATE_LIMIT_KEYED : RATE_LIMIT_ANON;
  const now = Date.now();
  let bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + limit.windowMs };
    rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= limit.max;
}

// Clean stale rate buckets every hour
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of rateBuckets) {
    if (now > bucket.resetAt) rateBuckets.delete(ip);
  }
}, 3600000);

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true });

// --- Schema (mirrors src/log/schema.mjs SharePayloadSchema) ---

const SharePayloadSchema = z.strictObject({
  v: z.literal(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  model: z.string().max(64).regex(/^[a-z0-9._-]+$/),
  speed: z.enum(["standard", "fast", "mixed"]),
  turn_count: z.number().int().min(1).max(100000),
  plan_tier: z.enum(["pro", "max_5", "max_20", "team", "enterprise", "unknown"]),
  total_input_tokens: z.number().int().min(0),
  total_output_tokens: z.number().int().min(0),
  total_cache_creation_tokens: z.number().int().min(0),
  total_cache_read_tokens: z.number().int().min(0),
  total_ephemeral_1h_tokens: z.number().int().min(0),
  total_ephemeral_5m_tokens: z.number().int().min(0),
  total_web_search_requests: z.number().int().min(0),
  avg_cache_hit_rate: z.number().min(0).max(1),
  q5h_start: z.number().min(0).max(2),
  q5h_end: z.number().min(0).max(2),
  q7d_start: z.number().min(0).max(2),
  q7d_end: z.number().min(0).max(2),
  q5h_total_delta: z.number().min(-1).max(2),
  q7d_total_delta: z.number().min(-1).max(2),
});

// --- API key management ---

function loadKeys() {
  try {
    return JSON.parse(readFileSync(KEYS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function isValidKey(key) {
  const keys = loadKeys();
  return !!keys[key];
}

function saveKeys(keys) {
  writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), "utf-8");
}

// --- Data storage ---

function getDataFile() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return join(DATA_DIR, `${month}.jsonl`);
}

function appendSubmission(payload) {
  const row = { ...payload, _submitted: new Date().toISOString() };
  appendFileSync(getDataFile(), JSON.stringify(row) + "\n", "utf-8");
}

function readAllSubmissions() {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".jsonl")).sort();
  const rows = [];
  for (const f of files) {
    const lines = readFileSync(join(DATA_DIR, f), "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch {}
    }
  }
  return rows;
}

// --- Request handling ---

async function readBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error("Body read timeout"));
    }, 10000); // 10s max

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        clearTimeout(timeout);
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", (e) => {
      clearTimeout(timeout);
      reject(e);
    });
  });
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function csvSanitize(val) {
  const s = String(val ?? "");
  // Prevent CSV formula injection: prefix with ' if starts with =, +, -, @, \t, \r
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  // Quote if contains comma, newline, or double quote
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvFromRows(rows) {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]).filter((k) => !k.startsWith("_"));
  const header = keys.map(csvSanitize).join(",");
  const lines = rows.map((r) => keys.map((k) => csvSanitize(r[k])).join(","));
  return [header, ...lines].join("\n");
}

// --- Routes ---

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
    });
    res.end();
    return;
  }

  try {
    // POST /api/v1/submit — accepts SharePayload or AnalysisSummary
    if (method === "POST" && path === "/api/v1/submit") {
      const apiKey = req.headers["x-api-key"];
      const hasKey = apiKey && isValidKey(apiKey);
      // Trust CF-Connecting-IP (set by Cloudflare, not spoofable) over X-Forwarded-For
      const clientIp = req.headers["cf-connecting-ip"] || req.socket.remoteAddress;

      if (!checkRateLimit(clientIp, hasKey)) {
        return json(res, 429, { error: "Rate limit exceeded. Try again tomorrow or register an API key." });
      }

      const body = await readBody(req);
      if (body.length > 65536) {
        return json(res, 413, { error: "Payload too large (max 64KB)" });
      }

      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "Invalid JSON" });
      }

      // Try both schemas — SharePayload (session summary) or AnalysisSummary (regression output)
      const shareResult = SharePayloadSchema.safeParse(payload);
      if (shareResult.success) {
        appendSubmission({ type: "session", auth: hasKey ? "key" : "anon", ...shareResult.data });
        return json(res, 201, { ok: true, type: "session" });
      }

      // Check if it's an analysis summary (has ols field)
      if (payload.ols && payload.n_sessions) {
        // Lightweight validation for analysis summaries
        if (typeof payload.v !== "number" || typeof payload.n_calls !== "number") {
          return json(res, 422, { error: "Analysis summary missing required fields" });
        }
        appendSubmission({ type: "analysis", auth: hasKey ? "key" : "anon", ...payload });
        return json(res, 201, { ok: true, type: "analysis" });
      }

      return json(res, 422, {
        error: "Schema validation failed — payload must match SharePayload or AnalysisSummary schema",
        issues: shareResult.error.issues.slice(0, 5).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    // GET /api/v1/dataset
    if (method === "GET" && path === "/api/v1/dataset") {
      const format = url.searchParams.get("format") || "json";
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "1000"), 10000);
      const rows = readAllSubmissions();
      const afterDate = url.searchParams.get("after");
      const modelFilter = url.searchParams.get("model");

      let filtered = rows;
      if (afterDate) filtered = filtered.filter((r) => r.date >= afterDate);
      if (modelFilter) filtered = filtered.filter((r) => r.model?.includes(modelFilter));
      filtered = filtered.slice(-limit); // last N rows

      if (format === "csv") {
        res.writeHead(200, {
          "Content-Type": "text/csv",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        });
        res.end(csvFromRows(filtered));
      } else {
        json(res, 200, { count: filtered.length, total: rows.length, data: filtered });
      }
      return;
    }

    // GET /api/v1/stats
    if (method === "GET" && path === "/api/v1/stats") {
      const rows = readAllSubmissions();
      const models = new Map();
      let totalTurns = 0;
      for (const r of rows) {
        models.set(r.model, (models.get(r.model) || 0) + 1);
        totalTurns += r.turn_count || 0;
      }
      return json(res, 200, {
        total_submissions: rows.length,
        total_turns: totalTurns,
        models: Object.fromEntries(models),
        earliest: rows.length > 0 ? rows[0].date : null,
        latest: rows.length > 0 ? rows[rows.length - 1].date : null,
      });
    }

    // GET /api/v1/schema
    if (method === "GET" && path === "/api/v1/schema") {
      return json(res, 200, {
        version: 1,
        description: "claude-meter share payload schema",
        fields: Object.keys(SharePayloadSchema.shape),
      });
    }

    // POST /api/v1/register — rate-limited key generation
    if (method === "POST" && path === "/api/v1/register") {
      const clientIp = req.socket.remoteAddress; // Don't trust X-Forwarded-For for registration
      if (!checkRateLimit(`register:${clientIp}`, false)) {
        return json(res, 429, { error: "Key registration rate limit exceeded" });
      }
      const key = "cm_" + randomBytes(24).toString("hex");
      const keys = loadKeys();
      if (Object.keys(keys).length > 10000) {
        return json(res, 503, { error: "Key limit reached" });
      }
      keys[key] = { created: new Date().toISOString(), ip_hash: createHash("sha256").update(clientIp).digest("hex").slice(0, 16) };
      try {
        saveKeys(keys);
      } catch {
        return json(res, 500, { error: "Key storage failed" });
      }
      return json(res, 201, { api_key: key });
    }

    // Static files from public/
    if (method === "GET") {
      const safePath = path === "/" ? "/index.html" : path.replace(/\.\./g, "");
      const filePath = join(PUBLIC_DIR, safePath);
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const ext = extname(filePath);
        const mime = MIME_TYPES[ext] || "application/octet-stream";
        const content = readFileSync(filePath);
        res.writeHead(200, {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(content);
        return;
      }
    }

    // 404
    json(res, 404, { error: "Not found" });
  } catch (e) {
    json(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`claude-meter server listening on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
