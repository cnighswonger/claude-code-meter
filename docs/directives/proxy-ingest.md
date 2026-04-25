# Directive: Proxy-mode ingestion

**Issue:** #2 (claude-meter), companion to `cnighswonger/claude-code-cache-fix#70` and `#81`
**Branch:** `feature/proxy-ingest`
**Stage:** directive + implementation (single PR)

## Why

CC v2.1.113+ ships as a Bun binary that ignores `NODE_OPTIONS=--import`. The `--import` preload mechanism that this collector has relied on since v0.1.0 is dead for every modern CC install. Cache-fix proxy v3.2.0 (PR #81 in that repo) now emits the **exact `MeterRowSchema` v:1** records this collector validates — straight to `~/.claude/usage.jsonl`. This PR closes the loop: switch claude-meter from in-process fetch interception to disk-based ingestion of the proxy's JSONL.

Wire format is unchanged. Validation is unchanged. Share / upload protocol is unchanged. Only the **source** of rows changes.

## Scope

In scope:
- New `src/ingest/jsonl-tailer.mjs` — reads `~/.claude/usage.jsonl` forward from a saved offset. Validates each line through the existing `MeterRowSchema` v:1. Skips invalid rows with debug log; never crashes the process.
- New `src/cli/ingest.mjs` — CLI command implementing `claude-meter ingest [--source <path>] [--once] [--watch] [--reset-offset]`.
- `bin/claude-meter.mjs` — add `ingest` subcommand to the dispatcher.
- `src/constants.mjs` — add `PROXY_LOG_FILE` (default `~/.claude/usage.jsonl`) and `INGEST_OFFSET_FILE` (default `~/.claude/.claude-meter-ingest-offset`).
- `src/interceptor/preload.mjs` — add a clear deprecation notice on import. Keep the file working for users who still have it pinned in `NODE_OPTIONS`, but warn on every load.
- `package.json` — drop `./preload` from `exports` (so `import "@claude-meter/collector/preload"` no longer resolves), bump version `0.3.0 → 0.4.0`, declare `claude-code-cache-fix >= 3.2.0` as the supported source in README/SESSION_STATE notes (not as an npm peerDep — these are separate packages with separate install paths).
- `README.md` — rewrite the integration section: install cache-fix proxy ≥3.2.0 → enable `usage-log` in `proxy/extensions.json` → run `claude-meter ingest`.
- Tests for the tailer (offset persistence, valid/invalid row handling, watch mode tick).

Out of scope:
- Share/upload protocol changes.
- Backfill of historical preload-written `~/.claude/claude-meter.jsonl` data. Already-collected data is what it is.
- Removing `src/interceptor/` entirely. That happens in the next major (v1.0.0). For v0.4.0 we keep the files and just warn.

## Wire contract

This PR consumes the wire format pinned in `cnighswonger/claude-code-cache-fix#81`. The proxy emits `MeterRowSchema` v:1 records exactly as defined by `src/log/schema.mjs` here. The schema file is NOT modified by this PR — the ingest path validates against the same strict schema the writer has always validated against.

A row is valid when `MeterRowSchema.parse(JSON.parse(line))` succeeds. Anything else is logged at debug level and skipped. Old 9-field rows from previous proxy `usage-log` versions WILL fail strict validation — they are skipped silently in production (debug log when `CLAUDE_METER_DEBUG=1`).

## Implementation choice

### Tailer

```
class JsonlTailer {
  constructor({ source, offsetFile, onRow, onSkip, onError })
  async tickOnce()    // read forward to current EOF, return { processed, skipped }
  async startWatch(intervalMs = 1000)   // periodic tickOnce
  async stopWatch()
}
```

- Offset is the last fully-processed byte position in the source file.
- Persist offset by writing `{ source, offset, updated_at }` to `offsetFile` after each successful tick.
- If the source file's current size is LESS than the saved offset (file truncated/rotated), reset offset to 0 and log a warning.
- Read forward from offset, split on `\n`, process complete lines. Carry an unfinished trailing fragment forward to the next tick (don't advance offset past it).
- For each complete line: `MeterRowSchema.parse`. On success: optional callback `onRow(row)`. On failure: `onSkip({ line, error })`.

### CLI subcommand

`claude-meter ingest`:
- Default mode: `--once` semantics. Read to current EOF, print summary `{ processed, skipped, offset }`, exit.
- `--watch` mode: tick every 1s indefinitely. Print summary every minute (or per-tick if any rows processed/skipped). Ctrl-C exits cleanly with a final summary.
- `--source <path>` overrides `PROXY_LOG_FILE` for one invocation.
- `--reset-offset` deletes the offset file before reading. Useful for re-ingesting from scratch (e.g., after a development session). Prints a warning and confirmation prompt unless `--yes` is set.

The ingest command does NOT submit to the share endpoint. It simply validates and counts. Share submission continues via `claude-meter share` / `claude-meter analyze --share` reading from the local validated rows. (For now, we treat the proxy JSONL as the source of validated rows directly; later we may merge into a unified local store.)

### Preload deprecation

`src/interceptor/preload.mjs` adds at the top:

```js
process.stderr.write(
  "[claude-meter] DEPRECATED: the preload interceptor is unsupported on " +
  "Claude Code v2.1.113+ (Bun binary ignores NODE_OPTIONS). " +
  "Switch to: install claude-code-cache-fix >= 3.2.0, enable the usage-log " +
  "extension, then run `claude-meter ingest --watch`. " +
  "This entry point will be removed in claude-meter v1.0.0.\n"
);
```

The fetch patch still installs (won't fire under Bun anyway, but stays correct under Node).

### `package.json` exports

Remove the `./preload` export. Users who run the preload directly via file path (`NODE_OPTIONS=--import /path/to/preload.mjs`) keep working — only the named `@claude-meter/collector/preload` import path goes away.

```json
"exports": {}
```

Or simply omit `exports` entirely. We don't expose a public ESM API beyond the CLI bin.

## Test plan

`test/ingest-tailer.test.mjs`:

1. **Empty file**: tailer on a non-existent source → returns `{ processed: 0, skipped: 0 }`, doesn't error.
2. **Single valid row**: write one MeterRowSchema-valid row → tickOnce processes it, offset advances to file size.
3. **Multiple rows**: write 5 valid rows → tickOnce processes all 5, offset at EOF.
4. **Trailing partial line**: write 2 rows + a half-written third → tickOnce processes 2, offset stops before the partial. Append the rest of row 3 → next tickOnce processes it.
5. **Invalid row mid-stream**: write valid, invalid (missing required field), valid → tickOnce reports `processed: 2, skipped: 1`. Offset still at EOF.
6. **Old proxy 9-field row**: write a v0 row with `peak_hour` and missing v field → skipped (strict validation).
7. **Offset persistence**: tickOnce twice with new rows added in between → second tick only processes the new rows.
8. **File truncation**: tickOnce, then truncate the source, then tickOnce → second tick resets offset to 0 and re-processes whatever's there.
9. **Watch mode tick**: startWatch with 50ms interval, append a row, wait 100ms → row is processed.

`test/cli-ingest.test.mjs` (lighter):

1. `claude-meter ingest --once` on an empty source → exits 0 with summary.
2. `claude-meter ingest --once --source <tmp>` with one valid row → exits 0, summary shows `processed: 1`.
3. `--reset-offset --yes` deletes the offset file before reading.

## Files modified / created

| File | Change |
|---|---|
| `src/ingest/jsonl-tailer.mjs` | NEW |
| `src/cli/ingest.mjs` | NEW |
| `src/constants.mjs` | Add `PROXY_LOG_FILE`, `INGEST_OFFSET_FILE` |
| `bin/claude-meter.mjs` | Add `ingest` case + help text |
| `src/interceptor/preload.mjs` | Add deprecation stderr write at top |
| `package.json` | Drop `./preload` from `exports`; bump `0.3.0 → 0.4.0` |
| `README.md` | Rewrite integration section |
| `test/ingest-tailer.test.mjs` | NEW |
| `test/cli-ingest.test.mjs` | NEW |
| `docs/directives/proxy-ingest.md` | THIS file |

## Reviewer checklist

- [ ] Tailer validates each row via `MeterRowSchema.parse` (strict v:1 only).
- [ ] Invalid rows are skipped, not silently accepted. `onSkip` callback receives both line and error.
- [ ] Offset is persisted after each tick and survives process restart.
- [ ] File truncation/rotation resets offset to 0 with a warning.
- [ ] Trailing partial line is preserved across ticks (not double-processed, not lost).
- [ ] Preload deprecation warning fires on every load.
- [ ] `package.json` `exports` no longer exposes `./preload`.
- [ ] Version bumped to `0.4.0`.
- [ ] README documents the new flow and pins `claude-code-cache-fix >= 3.2.0`.
- [ ] All tests pass.

— AI Team Lead
