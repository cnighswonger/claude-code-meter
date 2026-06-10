// src/rates.mjs — pure-data constants module.
//
// This module is browser-safe (no node: imports, no module-load side effects)
// so the dashboard chart components can consume it directly via Vite. The
// Node-only path setup (CLAUDE_DIR, LOG_FILE, etc.) stays in src/constants.mjs,
// which re-exports from this module for backwards compatibility with existing
// Node consumers (src/cli/analyze.mjs:2, src/cli/rates.mjs:2).
//
// See docs/directives/dashboard-dynamic-models.md for the full design.

// Official API pricing ($/MTok)
// Source: https://platform.claude.com/docs/en/docs/about-claude/pricing
// Last verified: 2026-04-14
// Cache multipliers: 5m write = 1.25x base, 1h write = 2x base, read = 0.1x base
//
// DISCLAIMER: These rates are copied from Anthropic's published pricing page.
// They may change without notice. Always verify against the source URL above.
// This tool provides ESTIMATES, not official billing statements.
export const RATES_LAST_VERIFIED = "2026-04-14";
export const RATES_SOURCE_URL = "https://platform.claude.com/docs/en/docs/about-claude/pricing";
export const KNOWN_RATES = {
  "claude-opus-4-7": {
    standard: { input: 5, output: 25, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.50 },
    fast: { input: 30, output: 150, cache_write_5m: 37.5, cache_write_1h: 60, cache_read: 3.0 },
  },
  "claude-opus-4-6": {
    standard: { input: 5, output: 25, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.50 },
    fast: { input: 30, output: 150, cache_write_5m: 37.5, cache_write_1h: 60, cache_read: 3.0 },
  },
  "claude-opus-4-5": {
    standard: { input: 5, output: 25, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.50 },
  },
  "claude-sonnet-4-6": {
    standard: { input: 3, output: 15, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.30 },
  },
  "claude-sonnet-4-5": {
    standard: { input: 3, output: 15, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.30 },
  },
  "claude-haiku-4-5": {
    standard: { input: 1, output: 5, cache_write_5m: 1.25, cache_write_1h: 2, cache_read: 0.10 },
  },
  "claude-haiku-3-5": {
    standard: { input: 0.80, output: 4, cache_write_5m: 1.0, cache_write_1h: 1.6, cache_read: 0.08 },
  },
  // claude-fable-5: pre-release rates from Anthropic email 2026-06-09; not
  // yet on the public pricing page. Cache rates derived from the documented
  // multipliers (5m write = 1.25x base, 1h write = 2x base, read = 0.1x base).
  // TODO: re-verify against published pricing page when claude-fable-5 goes GA.
  "claude-fable-5": {
    standard: { input: 10, output: 50, cache_write_5m: 12.50, cache_write_1h: 20, cache_read: 1.00 },
  },
};

// Subscription plan list prices ($/day, derived from monthly rate / 30).
//
// Source: https://claude.com/pricing
// Last verified: 2026-05-01
//
// Anthropic's pricing changes without notice; if the pricing page differs
// from these constants, the pricing page wins. Override at the CLI with
// --list-price-override <plan>=<usd_per_day>.
export const PLAN_LIST_PRICE_PER_DAY = {
  "pro": 0.667,         // $20/mo
  "max-5x": 3.333,      // $100/mo (5x Pro multiplier)
  "max-20x": 6.667,     // $200/mo (20x Pro multiplier)
  // Some installations may use the older single-tier "max" name; treat as max-5x.
  "max": 3.333,
  // API users have no flat-rate; L(t) is undefined for them.
  "api": null,
  "unknown": null,
};

// Display order for the by-model cost chart and per-model comparison
// cards. The dashboard reads this list in declared order to populate
// chart series. Entries MUST be keys present in KNOWN_RATES, but
// KNOWN_RATES may contain models not listed here (the chart hides any
// KNOWN_RATES entry not in MODEL_DISPLAY_ORDER — useful for deprecated
// models like claude-opus-4-5 / claude-sonnet-4-5 / claude-haiku-3-5
// which are kept for historical pricing but don't belong on the chart).
//
// Ordering criterion: observed median cost-per-turn from the most recent
// submitted analysis (cheap → expensive). For a NEW model with no
// observed data yet, use the rate card as tiebreaker — sort by per-MTok
// input price ascending, then per-MTok output price ascending.
//
// Note: the existing chart order (haiku, opus-4-6, sonnet-4-6, opus-4-7)
// is observed cost-per-turn order, not rate-card order — sonnet $3 input
// sits after opus-4-6 $5 because opus-4-6 sessions are observably cheaper
// per turn than sonnet-4-6 sessions in our community data. Preserve that
// observed-cost convention when adding new models.
export const MODEL_DISPLAY_ORDER = [
  "claude-haiku-4-5",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "claude-fable-5",   // most expensive — rate card $10/$50 vs opus-4-7's $5/$25
];

// The "baseline" model for cost-per-turn comparison cards (e.g.,
// "haiku-4-5 is ~10× cheaper than opus-4-7"). The chart components
// pick this model's cost-per-turn as the reference value for the
// "X% vs baseline" annotations on each bar. Change this when the
// editorial story shifts (e.g., when opus-4-6 sunsets, move the
// baseline to the next-most-used model).
//
// INVARIANT: MUST be a key present in MODEL_DISPLAY_ORDER. A unit
// test asserts this at CI to fail-fast on misconfiguration before any
// production render. Renderer behavior when the baseline has zero data
// in the current window: surface the condition explicitly in the chart
// (e.g., "baseline N/A" annotation), NOT a silent re-baseline.
export const MODEL_BASELINE = "claude-opus-4-6";

// The editorial cost-comparison pair surfaced in the per-model
// comparison cards (e.g., "haiku-4-5 is ~10× cheaper than opus-4-7").
// Both keys MUST be in MODEL_DISPLAY_ORDER and MUST be distinct. Change
// to retire the pair when the editorial story shifts. Unit tests assert
// both invariants.
export const EDITORIAL_COMPARISON_PAIR = {
  cheaper: "claude-haiku-4-5",
  expensive: "claude-opus-4-7",
};
