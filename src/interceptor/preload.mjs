/**
 * claude-meter interceptor preload.
 *
 * Load via: NODE_OPTIONS="--import @claude-meter/collector/preload"
 * or:       NODE_OPTIONS="--import /path/to/preload.mjs"
 *
 * This patches globalThis.fetch to capture usage metrics from Claude API
 * responses. It is strictly read-only — it never accesses request bodies
 * (prompts, code, files, tool schemas). Only response headers and the
 * usage object from the SSE stream are captured.
 *
 * Captured data is written to ~/.claude/claude-meter.jsonl as strictly
 * numeric + fixed-enum fields. No freeform text.
 */

import { installFetchPatch } from "./fetch-patch.mjs";
import { checkIntegrity } from "./integrity.mjs";

// Integrity check — warn if source was modified post-install
checkIntegrity(import.meta.url);

// Install the fetch interceptor
installFetchPatch();
