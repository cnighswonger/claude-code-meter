APPROVE

# Review: PR #35 — rates-windowing implementation

Date: 2026-06-18
Reviewed: implementation commit `c401e24`
Round: 1
Label applied: `approved-by-codex-agent`

## Findings

### Blockers

None.

### Attention Items

1. The column-scaling comment overstates what the implementation achieves.

   The window path scales each token column by its mean before calling the existing normal-equations solver, then back-scales the weights: `src/cli/rates.mjs:146`, `src/cli/rates.mjs:148`, `src/cli/rates.mjs:150`, `src/cli/rates.mjs:155`. That is an invertible column rescaling and is mathematically equivalent to solving on the raw columns; on the checked AITL fixture, scaled and unscaled weights match to floating-point noise. The surrounding comment claims the scaling avoids enough Gauss-Jordan roundoff that the input weight no longer drifts from a LAPACK reference: `src/cli/rates.mjs:136`, `src/cli/rates.mjs:141`. The code does not deliver that; the input coefficient remains about 6.285 against AITL's 8.39 target while output/cache_create/cache_read remain close. This is not a blocker because the directive allowed reuse of the existing OLS machinery and the cost-dominant weights still recover, but the comment should be corrected or the dead scaling removed in a cleanup.

2. The chronology hold-out test does not prove the specific held-out window identity.

   The implementation itself holds out the last qualifying window after sorting by `q5h_reset`: `src/cli/rates.mjs:87`, `src/cli/rates.mjs:89`, `src/cli/rates.mjs:117`, `src/cli/rates.mjs:118`. The test named "held-out is the most-recent qualifying window" only asserts the printed qualifying-window count: `test/rates-windowing.test.mjs:128`, `test/rates-windowing.test.mjs:140`, `test/rates-windowing.test.mjs:144`. It would not fail if the code held out an older qualifying window while preserving the same count. This is a test-strength gap, not an implementation blocker, because the production code is direct and correct.

3. The AITL fixture tolerance relaxation is acceptable for v1, but it should be treated as a solver limitation rather than a fixture truth change.

   The regression test now enforces R² >= 0.70 and tight recovery for output/cache_create, 10% for cache_read, and positivity-only for input: `test/rates-windowing.test.mjs:36`, `test/rates-windowing.test.mjs:60`, `test/rates-windowing.test.mjs:73`, `test/rates-windowing.test.mjs:75`, `test/rates-windowing.test.mjs:79`, `test/rates-windowing.test.mjs:82`. Given the directive's explicit maintainability constraint to reuse existing OLS machinery and avoid a new statistics subsystem, adding QR/SVD just to recover the low-leverage input coefficient would be disproportionate in this v1: `docs/directives/rates-windowing.md:49`. If future output depends on exact coefficient reproducibility, switching to QR/SVD is the right follow-up, but it should replace the normal-equations path deliberately rather than sit beside it.

### Nits

1. The raw-weight heading still says "quota fraction per token" even though window mode now fits percentage points per Mtok.

   The implementation intentionally sets `y = q5h_max * 100` and aggregates token columns in millions, so the recovered weights are pp/Mtok: `src/cli/rates.mjs:136`, `src/cli/rates.mjs:144`, `src/cli/rates.mjs:220`, `src/cli/rates.mjs:235`. The output heading inherited the older wording: `src/cli/rates.mjs:204`. This is display wording only; the numbers and scaling are correct.

2. `parseArgs` does not declare the default in the parser table itself.

   The directive requested `by` as `{ type: "string", default: "window" }`; the implementation declares `by` as a string option and applies the default in the `rates` dispatch: `bin/claude-meter.mjs:30`, `bin/claude-meter.mjs:118`. Behavior is correct, including validation and forwarding: `bin/claude-meter.mjs:119`, `bin/claude-meter.mjs:134`, `bin/claude-meter.mjs:137`.

## Contract Verification

### `bin/claude-meter.mjs`

The parser surface is correct. `--by` and `--tier-start-date` are declared in the top-level `parseArgs` options: `bin/claude-meter.mjs:29`, `bin/claude-meter.mjs:30`, `bin/claude-meter.mjs:31`. Help text documents the default window mode, the deprecated row mode, and the required tier-start date: `bin/claude-meter.mjs:71`, `bin/claude-meter.mjs:74`.

The `rates` dispatch accepts only `window` and `row`: `bin/claude-meter.mjs:118`, `bin/claude-meter.mjs:119`, and rejects invalid values with a non-zero exit: `bin/claude-meter.mjs:120`, `bin/claude-meter.mjs:121`. Window mode validates presence and `YYYY-MM-DD` shape for `--tier-start-date`: `bin/claude-meter.mjs:123`, `bin/claude-meter.mjs:125`, and prints the directive-specified error text: `bin/claude-meter.mjs:126`, `bin/claude-meter.mjs:128`. `--log-file` is forwarded through the same `logFile:` key used by analyze: `bin/claude-meter.mjs:134`, `bin/claude-meter.mjs:136`, `bin/claude-meter.mjs:149`, `bin/claude-meter.mjs:152`.

### `src/log/reader.mjs`

`groupByQuotaWindow(rows)` returns a `Map` keyed by `q5h_reset` with `{ q5h_reset, rows, q5h_max }`: `src/log/reader.mjs:71`, `src/log/reader.mjs:76`, `src/log/reader.mjs:82`. It skips rows with missing or null `q5h_reset`: `src/log/reader.mjs:74`, appends rows without side effects outside the local map: `src/log/reader.mjs:78`, `src/log/reader.mjs:79`, and computes `q5h_max` as the maximum numeric `q5h` in the window: `src/log/reader.mjs:80`.

### `src/cli/rates.mjs`

Window mode filters to the operator-supplied tier-start date before grouping: `src/cli/rates.mjs:38`, `src/cli/rates.mjs:39`. It excludes the in-progress current window by the largest `q5h_reset`: `src/cli/rates.mjs:53`, `src/cli/rates.mjs:54`, `src/cli/rates.mjs:55`, `src/cli/rates.mjs:61`.

The single-model filter is applied before per-pair fitting. `singlePairOf` returns `null` when any row differs by `(model|speed)` and otherwise returns that pair key: `src/cli/rates.mjs:210`, `src/cli/rates.mjs:213`, `src/cli/rates.mjs:215`, `src/cli/rates.mjs:217`. Mixed windows are skipped before any pair gets the window: `src/cli/rates.mjs:62`, `src/cli/rates.mjs:63`; each pair owns its own windows and fit: `src/cli/rates.mjs:64`, `src/cli/rates.mjs:68`, `src/cli/rates.mjs:79`, `src/cli/rates.mjs:80`.

The remaining filters happen before hold-out selection: `q5h_max >= 0.10` and `rows_per_window >= 20` are applied at `src/cli/rates.mjs:87`, `src/cli/rates.mjs:88`, then sorted chronologically at `src/cli/rates.mjs:89`. The most-recent qualifying completed window is held out and the fit uses the remainder: `src/cli/rates.mjs:117`, `src/cli/rates.mjs:118`. The one-window edge case is correctly separated from the N < 20 low-confidence warning: `src/cli/rates.mjs:103`, `src/cli/rates.mjs:111`, `src/cli/rates.mjs:120`, `src/cli/rates.mjs:129`.

The insufficient-data warning fires for N < 20 and numbers are still emitted afterward: `src/cli/rates.mjs:120`, `src/cli/rates.mjs:129`, `src/cli/rates.mjs:177`, `src/cli/rates.mjs:204`. Cache-fix labeling uses any non-empty `agent_id` or `request_id`, with the contracted thresholds: `src/cli/rates.mjs:238`, `src/cli/rates.mjs:242`, `src/cli/rates.mjs:246`, `src/cli/rates.mjs:247`, `src/cli/rates.mjs:248`, `src/cli/rates.mjs:249`.

Token aggregation uses `M = 1_000_000`, and the Y axis is `q5h_max * 100`, so weights are pp/Mtok: `src/cli/rates.mjs:136`, `src/cli/rates.mjs:144`, `src/cli/rates.mjs:220`, `src/cli/rates.mjs:234`, `src/cli/rates.mjs:235`. R² and held-out prediction are computed using back-scaled weights against raw token aggregates: `src/cli/rates.mjs:157`, `src/cli/rates.mjs:163`, `src/cli/rates.mjs:171`, `src/cli/rates.mjs:172`, `src/cli/rates.mjs:173`, `src/cli/rates.mjs:174`. Legacy row mode writes the deprecation notice before any row-mode output: `src/cli/rates.mjs:254`, `src/cli/rates.mjs:255`.

### `test/rates-windowing.test.mjs`

The subprocess CLI tests use the real entrypoint: `test/rates-windowing.test.mjs:27`, `test/rates-windowing.test.mjs:209`, `test/rates-windowing.test.mjs:227`, `test/rates-windowing.test.mjs:248`, and the accepted window-mode case routes fixture data through `--log-file`: `test/rates-windowing.test.mjs:246`, `test/rates-windowing.test.mjs:250`.

The AITL fixture test is correctly regression-only and fits all 90 chronology-stripped windows: `test/rates-windowing.test.mjs:36`, `test/rates-windowing.test.mjs:41`, `test/rates-windowing.test.mjs:44`. The synthetic row helpers match the schema-critical fields used by the implementation: `test/rates-windowing.test.mjs:87`, `test/rates-windowing.test.mjs:89`, `test/rates-windowing.test.mjs:90`, `test/rates-windowing.test.mjs:92`, `test/rates-windowing.test.mjs:96`, `test/rates-windowing.test.mjs:97`. Mixed-model, insufficient-data, and cache-label tests cover the required behavior and all three cache-fix regimes: `test/rates-windowing.test.mjs:149`, `test/rates-windowing.test.mjs:173`, `test/rates-windowing.test.mjs:179`, `test/rates-windowing.test.mjs:197`, `test/rates-windowing.test.mjs:202`, `test/rates-windowing.test.mjs:262`, `test/rates-windowing.test.mjs:272`, `test/rates-windowing.test.mjs:282`.

## Anti-Bloat / NFR

The implementation stays inside the locked surface area: parser dispatch, window grouping, rates window path, and focused tests. The implementation delta is 309 changed lines across the three production files and 317 new test lines: `bin/claude-meter.mjs`, `src/log/reader.mjs`, `src/cli/rates.mjs`, `test/rates-windowing.test.mjs`. That is above the rough 200/200 estimate but not near the directive's "materially past 2x" threshold, and the extra lines mostly come from explicit CLI and edge-case tests.

The formal load-bearing classification remains defensibly "No." The change is CLI behavior only, with no schema, wire, credential, or durable on-disk contract change: `docs/directives/rates-windowing.md:47`, `docs/directives/rates-windowing.md:53`.

## Verification

- `node --test test/rates-windowing.test.mjs test/rates-display.test.mjs` — 24/24 pass.
- `node --test test/*.test.mjs` — 109/109 pass.
- `git diff --check origin/main...HEAD -- bin/claude-meter.mjs src/log/reader.mjs src/cli/rates.mjs test/rates-windowing.test.mjs` — clean.

## Bottom Line

Approve. The implementation satisfies the locked window-mode contract: required CLI surface, all four window filters, per-`(model|speed)` independent fits, single hold-out, low-N warning with numeric output, cache-fix labeling, and real-entrypoint parser tests are present. The only review issues are non-blocking: tighten the hold-out test if this area changes again, and either remove or correct the column-scaling comment because it does not explain the remaining input-weight divergence.

— Codex review
