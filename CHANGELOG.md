# Changelog

## 0.6.0 (unreleased)

**Cost-multiplier reporting (M(t))** with an explicit, defensible methodology.

Every published M(t) number bakes in three hidden choices (numerator, denominator, aggregation grain). This release commits to one set publicly so claude-meter's reported numbers are reproducible and easy to disagree with productively. The formula:

    M(t)  =  sum(api_equivalent_cost)  /  ( daily_sub_price × calendar_days )

- **`analyze --by-plan`** — per-tier amortized M(t). Calendar-days denominator counts every day the subscription is paying for, including idle days. No span-extrapolation, no 1-hour floor.
- **`analyze --per-session`** — per-session "sub-days consumed" = `session_cost / daily_sub_price`. Strictly bounded; answers "was this session's API-equivalent value worth more or less than a day of my sub" without claiming sustained rates.
- **`analyze --burn-intensity`** — opt-in diagnostic that retains the old span-extrapolated formula for ranking sessions by intensity. Output includes a `caveat` field warning that sub-day sessions extrapolate above sustainable rates and should not be interpreted as M(t).
- **`analyze --session <sid>`** — filter all analysis to one session (full sid or unique prefix; ambiguous prefixes error with the matching set listed). When only one session remains, OLS + correlations are skipped (need ≥2); cost / M(t) blocks still produce useful output.
- **`analyze --plan-transitions "YYYY-MM-DD=tier,..."`** — attribute rows to a tier based on row timestamp, for windows where you switched plans mid-stream.
- **`analyze --list-price-override "tier=N.NN,..."`** — override `PLAN_LIST_PRICE_PER_DAY` defaults if Anthropic's published prices have shifted since the last release.
- **`PLAN_LIST_PRICE_PER_DAY`** constants in `src/constants.mjs` are pinned to [claude.com/pricing](https://claude.com/pricing) values verified 2026-05-01: Pro $20/mo, Max-5x $100/mo, Max-20x $200/mo (per-day = monthly ÷ 30).

**Caveat to flag:** the calendar-days denominator gives one number per host (per `~/.claude/claude-meter.jsonl`). Multi-agent setups will read substantially higher than a single user's typical session. The `--per-session` distribution surfaces the underlying spread.

**`analyze --share` interaction:** the new `by_plan` / `per_session` / `burn_intensity` blocks are stripped from the submission payload (they're host-aggregate local data, and the server-side schema doesn't admit them under the existing v:1 contract). The full local printout still includes them; only the bytes sent to the community endpoint are stripped. `--share` + `--session` is rejected with a clear error — single-session payloads don't produce the OLS regression the community dataset is built on.

## 0.5.0 (2026-04-30)

**Domain rebrand** — `meter.vsits.co` replaces `meter.veritassuperaitsolutions.com`.

- `DEFAULT_SERVER` updated; consent scope reissued under the new origin.
- `package.json` author email aligned to `dev@vsits.co`.
- Dashboard and analysis-page links migrated.
- No data format changes; existing local logs and proxy ingest continue to work without intervention.

**Server `/api/v1/stats` type-aware aggregation** (commit `0479685`):

- The community stats endpoint now correctly distinguishes share rows from analysis rows when computing aggregates, fixing a bug where mixed payload types produced incoherent counts.
- Includes new server-side tests covering both row types.

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
