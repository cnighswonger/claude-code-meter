import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = "0.1.0";
export const SCHEMA_VERSION = 1;
export const CLAUDE_DIR = join(homedir(), ".claude");
export const LOG_FILE = join(CLAUDE_DIR, "claude-meter.jsonl");
export const CONFIG_FILE = join(CLAUDE_DIR, "claude-meter-config.json");
export const MESSAGES_ENDPOINT = "/v1/messages";

// Proxy-mode ingestion sources (see docs/directives/proxy-ingest.md).
// Cache-fix proxy v3.2.0+ writes MeterRowSchema v:1 records to PROXY_LOG_FILE
// when its `usage-log` extension is enabled. We tail forward from
// INGEST_OFFSET_FILE to avoid re-processing rows across restarts.
export const PROXY_LOG_FILE = join(CLAUDE_DIR, "usage.jsonl");
export const INGEST_OFFSET_FILE = join(CLAUDE_DIR, ".claude-meter-ingest-offset");

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
};

// Community API server.
export const DEFAULT_SERVER = "https://meter.vsits.co";

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
  // API users have no flat-rate; M(t) is undefined for them.
  "api": null,
  "unknown": null,
};

// Rate-limit header names
export const HEADERS = {
  Q5H: "anthropic-ratelimit-unified-5h-utilization",
  Q7D: "anthropic-ratelimit-unified-7d-utilization",
  Q5H_RESET: "anthropic-ratelimit-unified-5h-reset",
  Q7D_RESET: "anthropic-ratelimit-unified-7d-reset",
  STATUS: "anthropic-ratelimit-unified-status",
  OVERAGE: "anthropic-ratelimit-unified-overage-status",
  CLAIM: "anthropic-ratelimit-unified-representative-claim",
  FALLBACK_PCT: "anthropic-ratelimit-unified-fallback-percentage",
  OVERAGE_UTIL: "anthropic-ratelimit-unified-overage-utilization",
  REPRESENTATIVE_CLAIM: "anthropic-ratelimit-unified-representative-claim",
  ORG_ID: "anthropic-organization-id",
  OVERAGE_DISABLED_REASON: "anthropic-ratelimit-unified-overage-disabled-reason",
};
