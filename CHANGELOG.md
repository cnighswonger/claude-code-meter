# Changelog

## 0.4.0 (2026-04-25)

**Proxy-mode ingestion** (#3, closes #2):

CC v2.1.113+ ships as a Bun binary that ignores `NODE_OPTIONS=--import`. The legacy preload interceptor stopped collecting data on every modern CC install. This release replaces the preload-based collection with a disk-tailing ingest path that reads from the new `claude-code-cache-fix >= 3.2.0` proxy's `~/.claude/usage.jsonl`.

- **New `claude-meter ingest [--source <path>] [--once] [--watch] [--reset-offset]`** — tails the proxy JSONL forward from a saved byte offset, validates each row against the existing strict `MeterRowSchema` v:1, and persists validated rows into `~/.claude/claude-meter.jsonl` so existing `analyze` / `share` / `status` / `history` / `rates` consumers see proxy data transparently.
- **Persistence safety**: `appendFileSync` errors do NOT advance the offset. The next tick re-reads the same row, giving the operator a chance to fix the underlying cause (disk full, permission denied, sink unmounted) without permanently dropping data. `--once` exits non-zero on persistence failures.
- **Offset persisted** to `~/.claude/.claude-meter-ingest-offset` so subsequent runs only process new rows. File truncation/rotation resets offset to 0 with a stderr warning.
- **Trailing partial lines preserved** across ticks (no double-processing, no loss).
- **Old proxy 9-field rows** (with `peak_hour`, no `v` field) fail strict validation and are skipped on the reader side. Documented as a one-time event — no backfill.

**Required producer**: this release declares `claude-code-cache-fix >= 3.2.0` as the supported source of `usage.jsonl` rows. The two packages are NOT independently shippable for the proxy-mode ingestion path.

**Preload deprecation**:

- `src/interceptor/preload.mjs` now writes a deprecation warning to stderr on every load. Documented removal in v1.0.0. Still loads under Node-binary CC ≤ v2.1.112 for users who need it.
- `./preload` removed from `package.json` `exports`. Direct `--import /path/to/preload.mjs` continues to work.

**Tests**: 14 new (10 tailer + 4 CLI). Schema, share/upload protocol, and downstream commands unchanged.

---

## 0.3.0 and earlier

CHANGELOG entries were not maintained for the v0.x series prior to this release. See npm publish history and GitHub commits for prior context.
