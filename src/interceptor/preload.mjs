/**
 * claude-meter interceptor preload.
 *
 * DEPRECATED: as of claude-meter v0.4.0, this preload is unsupported on
 * Claude Code v2.1.113+ (the Bun binary ignores NODE_OPTIONS). Use the
 * proxy-mode ingest path instead:
 *   1. Install claude-code-cache-fix >= 3.2.0
 *   2. Enable the `usage-log` extension in proxy/extensions.json:
 *        "usage-log": { "enabled": true, "order": 650 }
 *   3. Run `claude-meter ingest --watch`
 *
 * This entry point will be removed in claude-meter v1.0.0. The npm
 * `./preload` export was removed in v0.4.0; only direct file-path
 * `--import` still resolves it.
 *
 * Historical behavior (still in place under Node-binary CC ≤ v2.1.112):
 * patches globalThis.fetch to capture usage metrics from Claude API
 * responses. Read-only — never accesses request bodies. Captured data is
 * written to ~/.claude/claude-meter.jsonl.
 */

import { installFetchPatch } from "./fetch-patch.mjs";
import { checkIntegrity } from "./integrity.mjs";

process.stderr.write(
  "[claude-meter] DEPRECATED: the preload interceptor is unsupported on " +
    "Claude Code v2.1.113+ (Bun binary ignores NODE_OPTIONS). " +
    "Switch to: install claude-code-cache-fix >= 3.2.0, enable the " +
    "usage-log extension, then run `claude-meter ingest --watch`. " +
    "This entry point will be removed in claude-meter v1.0.0.\n",
);

// Integrity check — warn if source was modified post-install
checkIntegrity(import.meta.url);

// Install the fetch interceptor (no-op under Bun where fetch isn't patched).
installFetchPatch();
