APPROVE

# Review: PR #35 rates-windowing implementation freshness check

Date: 2026-06-18
Reviewed: cleanup commit `c70da0e`
Round: 2
Label applied: `approved-by-codex-agent`

## R1 Item Verification

AI #1, column-scaling comment: verified folded. The revised comment now says the fit target is q5h percentage points and the predictors are Mtok, then describes mean scaling as an invertible column rescaling that is equivalent on well-conditioned matrices and helps avoid singular-matrix failures on degenerate-but-valid synthetic inputs: `src/cli/rates.mjs:136`, `src/cli/rates.mjs:145`. It no longer claims scaling fixes the AITL input-weight drift. The scaling code is behaviorally unchanged except for the local variable rename from `X` to `scaledX`: column means are computed, zero means are guarded, rows are divided by those means, OLS runs on the scaled matrix, and weights are back-scaled: `src/cli/rates.mjs:149`, `src/cli/rates.mjs:158`.

AI #2, chronology hold-out test gap: verified folded. The test now gives the most-recent qualifying completed window reset `6000` a distinct `q5h_max` of `0.7`, asserts the held-out line reports `actual 70.0 pp`, and explicitly rejects the in-progress and sub-threshold alternatives: `test/rates-windowing.test.mjs:141`, `test/rates-windowing.test.mjs:159`. The four fit windows use independently varied token columns, and a direct rank check of those four aggregate rows is rank 4, so the test is not relying on a singular or constant-mix fixture. Because production prints the held-out window's own `q5h_max * 100`: `src/cli/rates.mjs:172`, `src/cli/rates.mjs:183`, this test would fail if the implementation held out the wrong qualifying window.

Nit #1, raw-weight label: verified folded. Window mode now prints `Raw weights (q5h percentage points per Mtok)`, matching its `q5h_max * 100` target and Mtok aggregation: `src/cli/rates.mjs:147`, `src/cli/rates.mjs:207`, `src/cli/rates.mjs:237`. Row mode still prints the legacy `Raw weights (quota fraction per token)` heading, which is correct because the row-mode math was intentionally left unchanged: `src/cli/rates.mjs:257`, `src/cli/rates.mjs:334`.

Nit #2, `parseArgs` default placement: verified folded. The `by` option now declares `default: "window"` in the parser table, and the rates dispatch consumes `values.by` directly without a second defaulting expression: `bin/claude-meter.mjs:30`, `bin/claude-meter.mjs:118`.

## Cross-Check Verification

`node --test test/*.test.mjs` passed with 109 tests, 8 suites, 0 failures. `git diff --check c70da0e^..c70da0e` is clean.

Behavioral parity with `c401e24` holds for the window-mode contract. The cleanup commit's production changes are comments, a local variable rename, the window-mode display heading, and parser-default placement; it does not alter the four hard-coded filters, per-pair fit grouping, single most-recent qualifying hold-out, insufficient-data warning path, cache-fix labeling, parser surface, or `--by row` deprecation notice. The cleanup commit touches only `bin/claude-meter.mjs`, `src/cli/rates.mjs`, and `test/rates-windowing.test.mjs`, with 41 insertions and 23 deletions, so there are no new on-disk surfaces, abstractions, or dead-code paths.

## Bottom Line

Approve. The four round-1 attention/nit items were folded as claimed, the cleanup stayed narrow, and the full test suite remains green.

-- Codex review
