import { z } from "zod";

// Per-API-call JSONL row schema — strictly numeric + fixed enums.
// No freeform text fields. No content from requests or responses.
//
// Schema version stays at `v: 1`; new fields added in minor releases must be
// `.optional()` so older emitters and older readers stay compatible. Removal
// or type-change of an existing field requires `v: 2` and the cross-repo
// rollout discipline documented in the cache-fix emitter at
// `proxy/extensions/usage-log.mjs:40-44`.
//
// agent_id / agent_id_source (v0.8.0 / cache-fix #215):
//
// Workflow-tool subagent attribution. Per upstream CC#66761, Claude Code
// sets the canonical `x-claude-code-agent-id` header on Task/Agent-tool
// subagents but NOT on Workflow-tool-spawned subagents. Operators running
// fan-out workflows (`agent()`, `parallel()`, `pipeline()`) need per-leg
// attribution to compute per-Workflow burn rate. The cache-fix proxy
// directive `proxy-workflow-agent-id-synthesis.md` derives a stable
// per-leg id when CC's canonical header is absent, emitted via
// `CACHE_FIX_USAGE_LOG_AGENT_ID=on` on cache-fix v4.3.0+.
//
// - `agent_id` is the value applications (dashboards, per-agent burn-rate
//   reports) consume. Opaque string — canonical CC header value when
//   present, or 16-hex chars when proxy-derived.
//
// - `agent_id_source` is the provenance: `"cc_header"` (canonical, the
//   request carried `x-claude-code-agent-id`) vs. `"cache_fix_derived"`
//   (proxy synthesized the id from Workflow markers because the header was
//   absent). Dashboards displaying per-agent data should distinguish the
//   two — canonical values are authoritative; cache-fix-derived values are
//   heuristic.
//
// Casing is a wire contract: snake_case (`cc_header`, `cache_fix_derived`)
// matches the schema's universal convention (`five_hour`, `seven_day`,
// `max_5`, `max_20`, `enterprise`, `standard`, `fast`, `mixed`). The
// emitter at `proxy/extensions/usage-log.mjs` must use the exact same
// snake_case byte sequences. Kebab-case (`cc-header`) is REJECTED.
//
// Validation invariant (enforced by `.superRefine()` below): if
// `agent_id_source` is present, `agent_id` MUST be present too
// (source-without-value is incoherent — a provenance label points at
// nothing). The reverse is allowed: `agent_id` may appear without
// `agent_id_source`, because the canonical/derived provenance is
// recoverable from `sid` + `request_id` correlation against the proxy
// event log.
//
// Operator attestation: setting `CACHE_FIX_USAGE_LOG_AGENT_ID=on` on the
// cache-fix proxy IS the operator's attestation that meter v0.8.0+ is
// installed. Setting it against older meter (v0.7.x) produces rows with
// unknown keys that the strict-object schema rejects — the visible
// symptom is a nonzero `skipped=` counter in `claude-meter ingest` tick
// output (validation error visible under `CLAUDE_METER_DEBUG=1`); the
// legacy `claude-meter write` path drops silently. Verify the meter
// version before flipping the env-var.
//
// Future enum-value additions to `agent_id_source` (e.g. a third value
// for dashboard-manual attribution) re-trigger the same meter-first /
// emitter-second rollout discipline — old meters reject rows carrying
// new enum values for the same reason they reject rows with new keys.
//
// `.superRefine()` wrap implications: `MeterRowSchema` is now a
// `ZodEffects` wrapper around the underlying `z.strictObject`. The
// wrap is safe today — `src/log/writer.mjs:68` and
// `src/ingest/jsonl-tailer.mjs:148` are the only validation chokepoints
// in the tree (both use `.safeParse()` / `.parse()`, which `ZodEffects`
// supports identically). Future maintainers extending the schema via
// `.shape`, `.extend()`, or `.pick()` must unwrap to the inner
// `z.strictObject` first; those properties don't traverse the wrap.
export const MeterRowSchema = z.strictObject({
  v: z.literal(1),
  ts: z.string().datetime(),
  sid: z.string().regex(/^[0-9a-f]{8}$/),

  // Model
  model: z.string().max(64).regex(/^[a-z0-9._-]+$/),
  requested_model: z.string().max(64).regex(/^[a-z0-9._-]*$/).optional(),
  model_mismatch: z.boolean().optional(),
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

  // Upstream request-id (cache-fix v4.1.0+, gated default-off via
  // CACHE_FIX_USAGE_LOG_REQID=on; default-on as of cache-fix v4.2.0).
  // Sourced from the upstream `request-id` response header verbatim — opaque,
  // server-generated, no regex enforced because format may evolve. Acts as
  // the post-hoc join key against CC's per-session JSONL transcripts at
  // ~/.claude/projects/<project>/<session-uuid>.jsonl (which carry the same
  // value as `requestId`), recovering per-CC-session attribution that the
  // proxy-boot-sticky `sid` field alone cannot provide.
  request_id: z.string().max(64).optional(),

  // Workflow-tool agent attribution (cache-fix v4.3.0+, gated default-off
  // via CACHE_FIX_USAGE_LOG_AGENT_ID=on). See the schema comment block
  // above for the full design, the operator-attestation contract, and the
  // .superRefine() invariant enforced after this object closes.
  agent_id: z.string().max(64).optional(),
  agent_id_source: z.enum(["cc_header", "cache_fix_derived"]).optional(),

  // Derived
  cache_hit_rate: z.number().min(0).max(1),
  q5h_delta: z.number(),
  q7d_delta: z.number(),
}).superRefine((row, ctx) => {
  // agent_id_source ⇒ agent_id. The reverse is allowed by design.
  if (row.agent_id_source !== undefined && row.agent_id === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["agent_id"],
      message: "agent_id is required when agent_id_source is present",
    });
  }
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
