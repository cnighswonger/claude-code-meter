# Changelog

> **Designator rename (2026-05-20):** The metric documented as `M(t)` in v0.6.x and earlier has been renamed to `L(t)` — "subscription-leverage multiplier" — after the M-symbol collided with @fgrosswig's `M_real` (`fgrosswig/claude-usage-dashboard`, a distinct compaction-penalty ratio). The formula, units, and reporting behavior are unchanged; only the designator differs. The historical entries below preserve the original `M(t)` name so the v0.6.x release record stays faithful to what shipped at the time. New code and docs use `L(t)`.

## [Unreleased]

## [0.8.0] - 2026-06-13

**Optional `agent_id` + `agent_id_source` fields on `MeterRowSchema` for Workflow-tool subagent attribution (refs [cnighswonger/claude-code-cache-fix#215](https://github.com/cnighswonger/claude-code-cache-fix/issues/215), refs upstream [anthropics/claude-code#66761](https://github.com/anthropics/claude-code/issues/66761)).** Per CC#66761, Claude Code sets the canonical `x-claude-code-agent-id` header on Task/Agent-tool subagents but NOT on Workflow-tool–spawned subagents — operators running fan-out workflows (`agent()`, `parallel()`, `pipeline()`) cannot attribute per-Workflow-leg cost. v0.8.0 adds the two fields the cache-fix proxy needs to emit for that gap to close:

- `agent_id` — string, max 64, optional. The attribution key for the request.
- `agent_id_source` — enum `"cc_header" | "cache_fix_derived"`, optional. The provenance of the value (canonical CC-header pass-through vs. cache-fix proxy-derived for Workflow-tool subagents whose canonical headers are absent).

Both fields are `.optional()`; schema version stays at `v: 1` (additive). The schema now carries a `.superRefine()` enforcing the asymmetric invariant: **`agent_id_source` present ⇒ `agent_id` present**. The reverse is allowed — `agent_id` may appear without `agent_id_source` because the canonical/derived provenance is recoverable from `sid` + `request_id` correlation against the proxy event log. **Casing is a wire contract**: snake_case (`cc_header`, `cache_fix_derived`) matches the schema's universal convention (`five_hour`, `seven_day`, `max_5`, `max_20`, `enterprise`, `standard`, `fast`, `mixed`); the cache-fix emitter at `proxy/extensions/usage-log.mjs` must use the exact same byte sequences. Kebab-case (`cc-header`) is REJECTED. Future enum-value additions to `agent_id_source` (e.g. a third value for dashboard-manual attribution) re-trigger the same meter-first / emitter-second rollout discipline — old meters reject rows carrying new enum values for the same reason they reject rows with new keys.

**Operator attestation contract.** Setting `CACHE_FIX_USAGE_LOG_AGENT_ID=on` on the cache-fix proxy IS the operator's attestation that meter v0.8.0+ is installed. Setting it against older meter (v0.7.x) produces rows with unknown keys that the strict-object schema rejects.

**Observable symptom of an attestation breach.** If you flip the env-var without upgrading meter, every emitted row carrying `agent_id` is rejected by the tailer. The visible symptom is a nonzero `skipped=` count in `claude-meter ingest` tick output; under `CLAUDE_METER_DEBUG=1` the skip is logged with the validation error and the row never appears in the dashboard. The legacy `claude-meter write` path drops silently with no log — operators relying on that path should verify their meter version before flipping the env-var.

**`.superRefine()` wrap implications.** `MeterRowSchema` is now a `ZodEffects` wrapper around the underlying `z.strictObject`. The wrap is safe today — `src/log/writer.mjs:68` and `src/ingest/jsonl-tailer.mjs:148` are the only validation chokepoints in the tree, both using `.safeParse()` / `.parse()` which `ZodEffects` supports identically. Future maintainers extending the schema via `.shape`, `.extend()`, or `.pick()` must unwrap to the inner `z.strictObject` first; those properties don't traverse the wrap.

**Tests.** 23 new cases in `test/schema-agent-id.test.mjs`: back-compat (both absent), both present (each enum value), value-without-source allowed, source-without-value REJECTED (each enum value), kebab-case rejection, unknown-enum rejection, 64-char boundary accept, 65-char boundary reject, type-rejection sweep (number/null/array/object/boolean), strict-object preservation through the wrap (unknown-sibling-key still rejects), request_id rollout regression, request_id + agent_id pair, plus three real writer/tailer round-trip cases exercising `src/log/writer.mjs`'s validation path and `src/ingest/jsonl-tailer.mjs`'s parse path: round-trip preservation with the new fields, round-trip back-compat without the fields, and round-trip attestation-breach symptom (bad row bypasses writer validation, lands on disk, tailer rejects via `.superRefine()` — `skipped=1` — proving the documented operator-visible counter fires through the file boundary). Existing `test/schema-request-id.test.mjs` continues to pass unchanged.

**Directive:** [`docs/directives/agent-id-schema-addition.md`](docs/directives/agent-id-schema-addition.md). Reviewed under the multi-LLM chain (Fable → Codex → AITL gate).

---

**Dashboard renders Fable-5 (and every future model added to `KNOWN_RATES`).** The community dashboard's chart components previously hardcoded a 4-model list (`opus-4-6`, `opus-4-7`, `haiku-4-5`, `sonnet-4-6`), so even though v0.7.1's analyzer priced Fable correctly, the chart never rendered it. Same silent-absent failure mode for every future Anthropic model.

**New module split.** `src/constants.mjs` mixed pure data (rates, plan prices) with Node-only path setup (`homedir()`, `join()` at module load), making it unimportable from the browser bundle. v0.8.0 splits them:

- `src/rates.mjs` (NEW, pure-data, browser-safe) — `KNOWN_RATES`, `RATES_LAST_VERIFIED`, `RATES_SOURCE_URL`, `PLAN_LIST_PRICE_PER_DAY`, plus three new display constants: `MODEL_DISPLAY_ORDER`, `MODEL_BASELINE`, `EDITORIAL_COMPARISON_PAIR`.
- `src/constants.mjs` (slimmed) — Node-only path setup (`CLAUDE_DIR`, `LOG_FILE`, `CONFIG_FILE`, `PROXY_LOG_FILE`, `INGEST_OFFSET_FILE`, `DEFAULT_SERVER`, `MESSAGES_ENDPOINT`, `HEADERS`, `VERSION`, `SCHEMA_VERSION`). Re-exports the moved symbols from `./rates.mjs` for backwards compatibility — existing Node consumers (`src/cli/analyze.mjs`, `src/cli/rates.mjs`) see no API change.

**Dashboard refactor.** The four chart components (`web/src/components/{charts,sections,analysis-charts,analysis-sections}.jsx`) now consume `MODEL_DISPLAY_ORDER`, `MODEL_BASELINE`, and `EDITORIAL_COMPARISON_PAIR` directly. Adding a model to `KNOWN_RATES` + `MODEL_DISPLAY_ORDER` automatically renders it in the by-model cost chart and the per-model comparison cards — no chart-component patch needed. User-visible labels (baseline annotation, substitution-endpoint labels, comparison-card copy) derive from `shortenModel(MODEL_BASELINE)` / `shortenModel(EDITORIAL_COMPARISON_PAIR.{cheaper,expensive})` so changing the constants updates both the math AND the visible story. Opus 4.7 advisory copy (the hidden-token hypothesis story) stays hardcoded — content, not configurable labels.

**New helper.** `web/src/lib/model-metrics.mjs` centralizes `getModelMetric(metrics, modelKey, field)` and `shortenModel(m)` for use by all 4 chart components.

**Tests.** 13 new cases in `test/rates-display.test.mjs`:

- `MODEL_DISPLAY_ORDER` is non-empty, all entries are `KNOWN_RATES` keys, no duplicates.
- `MODEL_BASELINE` is a non-empty string, key in `KNOWN_RATES`, key in `MODEL_DISPLAY_ORDER` (stronger invariant).
- `EDITORIAL_COMPARISON_PAIR.cheaper` and `.expensive` are both in `MODEL_DISPLAY_ORDER` and distinct.
- Re-export contract: each moved symbol imported from `src/constants.mjs` is referentially equal to the same symbol from `src/rates.mjs` — an implementation that omits or misspells a re-export fails at CI.
- `src/rates.mjs` has zero `node:*` imports (browser-safe contract).

**Vite config: `server.fs.allow: ['..']` added** to `web/vite.config.mjs` so the dev server can serve `../../../src/rates.mjs` to the chart components. Production Rollup build follows filesystem paths fine; this is dev-only.

**Directive:** `docs/directives/dashboard-dynamic-models.md`. Reviewed under the multi-LLM chain (Fable → Codex → AITL gate) — Fable round-1 caught the Vite bundler boundary and the `MODEL_DISPLAY_ORDER` ordering-invariant violation; Codex round-1 caught the re-export contract test gap and the user-visible-copy enumeration. Closes [#26](https://github.com/cnighswonger/claude-code-meter/issues/26).

## 0.7.1 (2026-06-10)

**Add `claude-fable-5` to `KNOWN_RATES` so Fable-5 calls are priced in cost analysis.**

Fable-5 began rolling out to users yesterday but the model name was missing from `src/constants.mjs KNOWN_RATES`. The analyzer's `cost_analysis.by_model` only prices models present in `KNOWN_RATES`, so Fable-5 calls showed in `model_splits.n_calls` (the call count) but contributed $0 to cost — silently undercounting any session that used Fable.

Rates from Anthropic email 2026-06-09 (pre-release projection; not yet on the [public pricing page](https://platform.claude.com/docs/en/docs/about-claude/pricing)):

- Standard: `input $10 / output $50 per MTok`
- Cache rates derived from the documented multipliers (`5m write = 1.25x base, 1h write = 2x base, read = 0.1x base`): `cache_write_5m $12.50 / cache_write_1h $20.00 / cache_read $1.00`

A `TODO` comment is pinned to the entry asking for re-verification against the published pricing page when Fable-5 goes GA.

No schema change, no behavior change for non-Fable models. Operators running Fable-5 will see the model appear in `cost_analysis.by_model` on the next `analyze --share`. Dashboard rendering of the new model category is a separate follow-up — the chart components currently hardcode a 4-model list that doesn't include Fable.

## 0.7.0 (2026-06-09)

**Schema acceptance for the optional `request_id` field on `MeterRowSchema v:1`.**

Added an optional `request_id: z.string().max(64).optional()` field to `MeterRowSchema`. The cache-fix proxy emits this value when its operator opts in via `CACHE_FIX_USAGE_LOG_REQID=on` (default-off in cache-fix v4.1.0; default-on as of cache-fix v4.2.0). Sourced from the upstream `request-id` response header verbatim.

Why this matters: cache-fix's `sid` field is `sha256(pid + Date.now() + Math.random()).slice(0, 8)` generated once at proxy boot and shared across every CC session that proxy serves. On multi-session hosts (agent fleets, concurrent runners), session-level cost questions are structurally unanswerable from the meter view — every session's rows collapse into the same `sid`. CC's per-session JSONL transcripts at `~/.claude/projects/<project>/<session-uuid>.jsonl` already carry `requestId` for every API call. With `request_id` in the meter row, the post-hoc join recovers per-CC-session attribution.

**Cross-repo release-ordering contract:**

- Producer (`claude-code-cache-fix` v4.1.0): default-OFF gate so unpatched meter installs don't ingest rows that fail validation. Field emitted only when operator opts in.
- Consumer (this release): accepts the optional field; rows without it still validate (back-compat). No behavior change for operators not running the cache-fix gate.
- Producer follow-up (`claude-code-cache-fix` v4.2.0): flips default-on. **Operators upgrading to cache-fix v4.2.0 must run claude-meter v0.7.0+ to ingest those rows.**

Schema stays at `v: 1` (pure addition; no consumer's reading of existing fields changes). Strict-object semantics preserved — unknown sibling keys still reject.

Tests: 7 new cases in `test/schema-request-id.test.mjs` covering back-compat (absent field), positive cases (valid value, 64-char boundary, 1-char minimum), negative cases (65-char tripwire, non-string types), and strict-object behavior preservation.

See cache-fix [`docs/directives/proxy-usage-log-request-id.md`](https://github.com/cnighswonger/claude-code-cache-fix/blob/main/docs/directives/proxy-usage-log-request-id.md) for the full producer-side directive and rationale.

## 0.6.1 (2026-05-05)

**Documentation: M_real attribution to `fgrosswig/claude-usage-dashboard`** (closes [#10](https://github.com/cnighswonger/claude-code-meter/issues/10)).

The subscription cost-multiplier concept that meter ships as `M(t)` was first published in [fgrosswig/claude-usage-dashboard](https://github.com/fgrosswig/claude-usage-dashboard) as `M_real` / `computeSessionMt` 18 days earlier (April 13 2026). README's Related section now reflects that lineage; the v0.6.0 CHANGELOG entry below has been amended retroactively at @fgrosswig's request to carry the same note.

**Test runner cleanup** (no behavior change to the shipped package).

- `test/server-security.test.mjs` had a dead `before` hook from an abandoned in-process server-import approach. Because `server/index.mjs` calls `server.listen()` at module top level, importing it from inside the test runner kept the event loop alive and hung the entire test file before the working subprocess-based `before` could run. Dead hook removed; the subprocess approach is now the only setup path.
- `package.json` `test` script changed from `node --test test/` to `node --test test/*.test.mjs` for Node 24 compatibility (Node 24 interprets bare `test/` as a module specifier rather than a directory).
- Result: `npm test` now runs cleanly with 43/43 passing on Node 24.

No runtime/library code changes. v0.6.1 is functionally identical to v0.6.0 for end users; only test infrastructure and docs differ.

## 0.6.0 (2026-05-02)

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

**Note** *(added retroactively in v0.6.1, 2026-05-05)*: The subscription value multiplier concept was first published in [fgrosswig/claude-usage-dashboard](https://github.com/fgrosswig/claude-usage-dashboard) (`M_real`, April 13 2026). meter's `M(t)` uses a calendar-day formula; claude-usage-dashboard uses a session-based quadratic model.

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
