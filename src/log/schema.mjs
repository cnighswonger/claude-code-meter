import { z } from "zod";

// Per-API-call JSONL row schema — strictly numeric + fixed enums.
// No freeform text fields. No content from requests or responses.
export const MeterRowSchema = z.strictObject({
  v: z.literal(1),
  ts: z.string().datetime(),
  sid: z.string().regex(/^[0-9a-f]{8}$/),

  // Model
  model: z.string().max(64).regex(/^[a-z0-9._-]+$/),
  speed: z.enum(["standard", "fast", ""]),
  service_tier: z.string().max(32).regex(/^[a-z0-9_-]*$/),

  // Token usage
  input_tokens: z.number().int().min(0),
  output_tokens: z.number().int().min(0),
  cache_creation_input_tokens: z.number().int().min(0),
  cache_read_input_tokens: z.number().int().min(0),
  ephemeral_1h_input_tokens: z.number().int().min(0),
  ephemeral_5m_input_tokens: z.number().int().min(0),
  web_search_requests: z.number().int().min(0),

  // Quota state from response headers
  q5h: z.number().min(0).max(2),           // Utilization 0-1 (can exceed 1 in overage)
  q7d: z.number().min(0).max(2),
  q5h_reset: z.number().int().min(0),       // Unix epoch seconds
  q7d_reset: z.number().int().min(0),
  qstatus: z.string().max(32).regex(/^[a-z_]*$/),
  qoverage: z.string().max(32).regex(/^[a-z_]*$/),
  qclaim: z.string().max(16).regex(/^[a-z_]*$/),
  qfallback_pct: z.number().min(0).max(1),

  // Derived
  cache_hit_rate: z.number().min(0).max(1),
  q5h_delta: z.number(),
  q7d_delta: z.number(),
});

// Community share payload — per-session aggregate
export const SharePayloadSchema = z.strictObject({
  v: z.literal(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  model: z.string().max(64).regex(/^[a-z0-9._-]+$/),
  speed: z.enum(["standard", "fast", "mixed"]),
  turn_count: z.number().int().min(1).max(100000),
  plan_tier: z.enum(["pro", "max_5", "max_20", "team", "enterprise", "unknown"]),

  // Aggregated tokens
  total_input_tokens: z.number().int().min(0),
  total_output_tokens: z.number().int().min(0),
  total_cache_creation_tokens: z.number().int().min(0),
  total_cache_read_tokens: z.number().int().min(0),
  total_ephemeral_1h_tokens: z.number().int().min(0),
  total_ephemeral_5m_tokens: z.number().int().min(0),
  total_web_search_requests: z.number().int().min(0),

  // Cache efficiency
  avg_cache_hit_rate: z.number().min(0).max(1),

  // Quota observations (the key regression data)
  q5h_start: z.number().min(0).max(2),
  q5h_end: z.number().min(0).max(2),
  q7d_start: z.number().min(0).max(2),
  q7d_end: z.number().min(0).max(2),
  q5h_total_delta: z.number().min(-1).max(2),
  q7d_total_delta: z.number().min(-1).max(2),
});
