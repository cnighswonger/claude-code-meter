import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = "0.1.0";
export const SCHEMA_VERSION = 1;
export const CLAUDE_DIR = join(homedir(), ".claude");
export const LOG_FILE = join(CLAUDE_DIR, "claude-meter.jsonl");
export const CONFIG_FILE = join(CLAUDE_DIR, "claude-meter-config.json");
export const MESSAGES_ENDPOINT = "/v1/messages";

// Known API pricing ($/MTok) from https://platform.claude.com/docs/en/build-with-claude/prompt-caching#pricing
// Cache write rates differ by TTL tier: 5m = 1.25x base, 1h = 2x base
// Used as ground truth for validating regression output
export const KNOWN_RATES = {
  "claude-opus-4-6": {
    standard: { input: 5, output: 25, cache_write_5m: 6.25, cache_write_1h: 10, cache_read: 0.5 },
    fast: { input: 30, output: 150, cache_write_5m: 37.5, cache_write_1h: 60, cache_read: 3 },
  },
  "claude-sonnet-4-6": {
    standard: { input: 3, output: 15, cache_write_5m: 3.75, cache_write_1h: 6, cache_read: 0.3 },
  },
  "claude-haiku-4-5": {
    standard: { input: 1, output: 5, cache_write_5m: 1.25, cache_write_1h: 2, cache_read: 0.1 },
  },
};

// Community API server
export const DEFAULT_SERVER = "https://meter.veritassuperaitsolutions.com";

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
};
