import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = "0.1.0";
export const SCHEMA_VERSION = 1;
export const CLAUDE_DIR = join(homedir(), ".claude");
export const LOG_FILE = join(CLAUDE_DIR, "claude-meter.jsonl");
export const CONFIG_FILE = join(CLAUDE_DIR, "claude-meter-config.json");
export const MESSAGES_ENDPOINT = "/v1/messages";

// Known API pricing ($/MTok) from Claude Code source modelCost.ts
// Used as ground truth for validating regression output
export const KNOWN_RATES = {
  "claude-opus-4-6": {
    standard: { input: 5, output: 25, cache_write: 6.25, cache_read: 0.5 },
    fast: { input: 30, output: 150, cache_write: 37.5, cache_read: 3 },
  },
  "claude-sonnet-4-6": {
    standard: { input: 3, output: 15, cache_write: 3.75, cache_read: 0.3 },
  },
  "claude-haiku-4-5": {
    standard: { input: 1, output: 5, cache_write: 1.25, cache_read: 0.1 },
  },
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
};
