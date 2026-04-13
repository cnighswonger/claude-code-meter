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
  qoverage_util: z.number().min(0).optional(),         // anthropic-ratelimit-unified-overage-utilization
  qrepresentative_claim: z.string().max(16).regex(/^[a-z0-9_]*$/).optional(),  // five_hour | seven_day
  org_id: z.string().max(64).regex(/^[a-zA-Z0-9_-]*$/).optional(),            // anthropic-organization-id (hashed)
  overage_disabled_reason: z.string().max(64).optional(),                       // only present when overage blocked

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
  fallback_pct: z.number().min(0).max(1).optional(),
  representative_claim_distribution: z.record(z.number().int().min(0)).optional(),  // e.g. { five_hour: 340, seven_day: 60 }
  overage_events: z.number().int().min(0).optional(),
  rejected_events: z.number().int().min(0).optional(),
});

// analyze --fit output schema — session-level OLS regression summary
export const AnalysisSummarySchema = z.strictObject({
  v: z.literal(1),
  generated_at: z.string().datetime(),
  data_range: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
  }),

  // Account-level
  plan_tier: z.enum(["pro", "max_5", "max_20", "team", "enterprise", "unknown"]),
  fallback_pct: z.number().min(0).max(1).optional(),

  // Dataset summary
  n_sessions: z.number().int().min(1),
  n_calls: z.number().int().min(1),
  n_drain_events: z.number().int().min(0),
  n_rejected: z.number().int().min(0),

  // Session-level OLS regression
  ols: z.object({
    r_squared: z.number().min(0).max(1),
    coefficients: z.record(z.number()),     // { avg_output: 1.05e-5, avg_cache_creation: 3.75e-7, ... }
    p_values: z.record(z.number()).optional(),
  }),

  // Per-feature Pearson correlations with Q5h delta
  correlations: z.record(z.number()),       // { avg_output: 0.83, avg_cache_read: -0.014, ... }

  // Cumulative exponent distribution across sessions
  exponents: z.object({
    mean: z.number(),
    median: z.number(),
    std: z.number(),
    n_superlinear: z.number().int(),        // sessions with b > 1.3
    n_total: z.number().int(),
  }),

  // Splits
  peak_vs_offpeak: z.object({
    peak_avg_q5h_per_turn: z.number(),
    offpeak_avg_q5h_per_turn: z.number(),
  }).optional(),

  model_splits: z.record(z.object({
    n_calls: z.number().int(),
    avg_q5h_per_turn: z.number(),
  })).optional(),
});
