import { homedir } from "node:os";
import { join } from "node:path";

// Pure-data constants (KNOWN_RATES, PLAN_LIST_PRICE_PER_DAY, etc.) moved
// to src/rates.mjs so the dashboard chart components can import them
// without dragging node:os / node:path into the browser bundle. This
// module re-exports them for backwards compatibility with existing
// Node consumers (src/cli/analyze.mjs:2, src/cli/rates.mjs:2).
//
// See docs/directives/dashboard-dynamic-models.md for the full design.
export {
  KNOWN_RATES,
  RATES_LAST_VERIFIED,
  RATES_SOURCE_URL,
  PLAN_LIST_PRICE_PER_DAY,
} from "./rates.mjs";

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

// Community API server.
export const DEFAULT_SERVER = "https://meter.vsits.co";

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
