# Directive: regress `rates` at Q5h-window granularity, not per-row

**Issues:** [#33](https://github.com/cnighswonger/claude-code-meter/issues/33) (this directive) + [#34](https://github.com/cnighswonger/claude-code-meter/issues/34) (follow-up; depends on this contract)
**Directive branch / Implementation branch:** `feature/rates-windowing` (single branch — the contract is narrow enough that the directive + implementation can ride together; see "Process" below)
**Stage:** directive — round 2 (Codex r2: APPROVE_WITH_NITS; nits folded as r2.1)
**Milestone:** v0.8.1 (patch — `rates` CLI semantics change, no schema change)

## Revision history

- **r1 → r2** (this amendment): folded Codex r1 REQUEST_CHANGES findings.
  - Added `bin/claude-meter.mjs` as a load-bearing implementation surface with explicit `parseArgs` flag declarations for `--by` and `--tier-start-date`; CLI-parser tests run as subprocess against the entrypoint, not just direct `ratesCommand` calls (Codex r1 Blocker 1).
  - Chronology rules now exercised against a separate synthetic chronology fixture; the AITL anonymized fixture remains regression-only (Codex r1 Blocker 2; AITL adjudication: option B).
  - Mixed-model windows: defined as contract-critical — group by `q5h_reset` AND filter to single-model windows, fit per `(model|speed)`, drop mixed windows from every fit (Codex r1 Blocker 3; AITL adjudication: option C). Added insufficient-data warning when N < 20 per pair.
  - Cache-fix marker detection cites the actual schema row keys (`agent_id`, `request_id`) from `src/log/schema.mjs:105`/`:115`, not `_workflowAgentId`.
  - Held-out validation language clarified to single-hold-out (was ambiguous between leave-one-out and v1's actual single hold-out).
  - Removed pseudocode `--fixture` flag from verification; tests load the AITL fixture by direct file read in the harness.
  - Sparse-data error message phrasing reframed as "collect more data or use deprecated `--by row` for legacy comparison."
  - LOC budget revised to ~200 impl + ~200 tests to account for added CLI plumbing + synthetic fixture + insufficient-data path.
- **r2 → r2.1** (this in-place edit): folded Codex r2 APPROVE_WITH_NITS items.
  - Subprocess parser tests now route fixture data via the existing `--log-file` global flag (forwarded by extending the `rates` dispatch to mirror `analyze`'s `logFile:` shape), eliminating Codex r2's "how does fixture data reach `bin/claude-meter.mjs`?" ambiguity.
  - §"Mixed-model windows" section title relabeled "contract-critical" with a parenthetical clarifying that the section header does not raise the formal NFR `Load-bearing` classification (which remains "No"). Disambiguates the overloaded "load-bearing" usage Codex r2 flagged as a nit.

## Goal

Fix the `rates` command so the recovered Q5h weights are useful. Today `rates` runs OLS at per-row granularity, where `q5h_delta` is dominated by the API's 0.01 quantization floor and the regression returns nonsense (measured R² = −0.10, recovered weights diverge from prediction-time validation by 100×+).

This directive moves the regression to Q5h-window granularity (rows aggregated by `q5h_reset` timestamp), recovers usable weights, and reports R² + held-out window prediction error so reviewers can validate the fit.

## Why

Anthropic's `q5h` field is quantized to 0.01 in the API response. A typical individual request shifts the ledger by less than the quantization step, so the per-row `q5h_delta` is 0 or 0.01 for most rows. OLS sees a near-flat `y` at varying `x` and fits a near-zero slope.

Window-level totals sum hundreds of rows; the per-row quantization noise on `q5h_delta` averages out, and `q5h_max * 100` (cumulative pp consumed in the window) is high-precision relative to the granularity of the summed token counts.

Empirically (single-host Max 2x sample, Opus 4.7, post-renewal 2026-05-23 sample provided by AITL):

| Mode | R² | Held-out window prediction error |
|---|---|---|
| Per-row (current) | −0.1030 | n/a (weights diverge from validation) |
| Per-window (this directive) | 0.7148 | 2.3% (predicted 58.3 pp vs actual 57 pp) |

The per-window weights match the empirical decomposition Anthropic appears to apply: cache_create at ~381× cache_read in the Q5h ledger (vs 12.5× in pricing), output at ~2,318× (vs 50× in pricing). Per-row weights miss this entirely — the recovered relative ratios bear no resemblance to either pricing or empirical observation.

This isn't a "nice to have" precision improvement. The per-row regression returns garbage that can mislead operators trying to identify which token mix drives their Q5h burn. Shipping it as the default is a correctness bug.

## Non-Functional Requirements

- **Size/complexity budget:** ~200 LOC implementation (window aggregator + window-mode regression path + held-out validation + `bin/claude-meter.mjs` parser additions + insufficient-data warning + single-model filter) + ~200 LOC tests (AITL fixture-driven weight recovery + synthetic chronology fixture + subprocess CLI-parser tests). Reviewers should flag if this drifts materially past 2× the budget.

- **Threat model:** no new on-disk surface, no new credentials, no new wire fields. The CLI reads the same JSONL the existing `rates` command reads. The fixture file added to the repo is the AITL-provided anonymized sample (90 `(cache_read_M, cache_create_M, input_M, output_M, q5h_max)` tuples, Codex-cleared SAFE_TO_SHIP — no per-row data, no sids, no timestamps, no source attribution, shuffled). No change to threat profile from the existing `rates` command.

- **Maintainability constraints:** the window aggregator goes in `src/log/reader.mjs` as a new exported function. No new module needed. The OLS regression machinery in `src/cli/rates.mjs` (`olsRegression`, `invertMatrix`) is reusable — the window-mode path constructs the same `X`/`y` matrix shape, just at window granularity. No new abstractions; the diff is a feature flag on aggregation, not a new code spine.

- **Performance/reliability:** the aggregator is O(rows). Held-out validation is a single hold-out: per `(model|speed)`, drop the most-recent qualifying completed window, fit OLS on the remainder, predict the held-out window's `q5h_max`, report the percent error. No leave-one-out machinery in v1. Hold-out window selection is deterministic from chronology (most-recent qualifying after applying all filters) — no random sampling.

- **Load-bearing? No.** The change is to a `rates` CLI semantics knob. No schema change. No wire contract change. The dashboard at meter.vsits.co does NOT consume `rates` output (per AITL); the CLI is the sole consumer. The `--by row` back-compat opt-out (see §"CLI surface" below) covers anyone scripting against the prior weights.

## CLI surface

### New default behavior

`rates` (no `--by` flag) runs the new window-mode regression. Output shape:

```
Model: claude-opus-4-7 (standard)
Mode: window (88 Q5h windows aggregated from 3530 rows)

  R-squared:                   0.7148
  Held-out window error:       2.3% (predicted 58.3 pp vs actual 57.0 pp)

  Relative billing weights (normalized to input = 1.0):
    Input              1.000
    Output             7.249
    Cache Read         0.003
    Cache Write        1.193

  Known API rate ratios (for comparison):
    Input              1.000
    Output             5.000
    Cache Read         0.100
    Cache Write        2.000

  Raw weights (quota fraction per token):
    Input              8.3862e+00
    Output             6.0805e+01
    Cache Read         2.6200e-02
    Cache Write        1.0006e+01
```

The "Mode: window (N Q5h windows aggregated from M rows)" line is the contract-visible signal that distinguishes the window fit from the deprecated per-row fit. The "Held-out window error" line is the load-bearing validation metric.

### Opt-out: `--by row` (one release only, with deprecation notice)

`rates --by row` runs the legacy per-row regression for back-compat. The output appends a deprecation notice:

```
DEPRECATED: --by row produces unreliable weights (R² is typically negative
on real data). Defaulting to --by window in v0.8.1 and removing --by row
in v0.9.0. See https://github.com/cnighswonger/claude-code-meter/issues/33
```

The deprecation notice prints to stderr so it doesn't pollute scripted-consumer stdout that may parse the weights output.

### New required flag: `--tier-start-date <YYYY-MM-DD>`

The window aggregation must be filtered to a single (model, tier) regime. Q5h normalizes against different absolute ceilings on Max 5x / Max 20x / Max 2x; mixing them in a single fit produces meaningless weights.

`--tier-start-date <YYYY-MM-DD>` is required for v1. It filters rows to those with `ts >= <date>`. Operators who don't know their tier-start can use the analyze tool or the dashboard to find their last plan-renewal date.

Inference (deriving tier-start from the first observed `q7d` reset after install) is explicitly deferred to a follow-up. Inference adds a magic layer that's hard to debug when wrong, especially for mid-week installs. Required flag for v1; inference can ride on top once we have a corpus to validate against.

### Other filter thresholds (hard-coded, not flagged)

The window-mode aggregator applies four filters before regression:

1. **`q5h_max >= 0.10`** — windows with less than 10% Q5h consumption don't carry enough signal to constrain the fit.
2. **`rows_per_window >= 20`** — windows with fewer than 20 rows likely represent a brief use spike or partial-window observation, not a real workload.
3. **Excludes the in-progress current window** — the most-recent window's `q5h_max` is still moving and the row count is incomplete. The most-recent qualifying COMPLETED window is held out for validation; the second-most-recent and older qualifying windows form the fit set.
4. **Single-model windows only** — a Q5h window with rows from more than one `(model|speed)` pair is dropped from that pair's fit set. See §"Mixed-model windows" below for the contract-critical rationale.

These thresholds are hard-coded for v1. Operators with sparse data who hit the "no qualifying windows" floor see a clear error message: *"No qualifying windows for (model|speed). Collect more data or use deprecated `--by row` for legacy comparison."*

### Mixed-model windows (contract-critical)

> "Contract-critical" here means **must implement exactly as specified** — it does not raise the formal NFR `Load-bearing` classification above, which remains "No" (CLI-semantics-only change, no schema or wire contract change). The section title flagged this distinction for implementation reviewers per Codex r2 nit.


`q5h_max` is account-level — Anthropic charges Q5h against the account, not a specific model. Token columns (`cache_read`, `cache_create`, `input`, `output`) are model-scoped. A Q5h window with rows from multiple `(model|speed)` pairs cannot be cleanly attributed: the recovered per-model weights would mix model-A token counts with the account-level Q5h burn driven partly by model B.

The window-mode contract groups by `q5h_reset` AND filters to windows where every row in the window shares the same `(model|speed)`. Mixed-model windows are dropped from every model's fit set. Each `(model|speed)` reports its own R², held-out error, and recovered weights independently. Operators running heavy multi-model traffic will see fewer qualifying windows per model.

When a `(model|speed)` has fewer than 20 qualifying single-model windows after all filters, the output emits an "Insufficient data" warning above the numbers and labels the fit as low-confidence. The numbers are still produced (R², weights, held-out error) so operators can sanity-check trends, but the warning signals that the result should not be treated as authoritative.

### Cache-fix observer-effect labeling

The output line "Mode: window (N Q5h windows aggregated from M rows)" gains a third element when `cache_fix_active` is detected:

```
Mode: window (88 Q5h windows aggregated from 3530 rows, cache_fix_active)
```

Detection signal: the aggregator scans the rows in scope. A row is treated as cache-fix-touched if either `agent_id` (any non-empty value) or `request_id` (any non-empty value) is present on the row. These are the actual row keys per `src/log/schema.mjs:105` (`request_id`, upstream response-id header) and `src/log/schema.mjs:115` (`agent_id`, cache-fix v4.3.0+ workflow-tool attribution). If ≥50% of rows carry either marker, the label is `cache_fix_active`. If <10% carry either marker, the label is omitted (meter-only operation). If between 10% and 50%, the label is `cache_fix_mixed` and the operator is warned that the regression is fitting a mixed-substrate workload.

This is a v1 detection heuristic; the directive defers a stricter signal (specific extension-emitted flag in the JSONL) to the cache-fix repo's follow-up work. The 50%/10% thresholds are empirical and may be tuned in the implementation review.

This label flows directly to the #34 weight-history ledger when that work lands; recording it now avoids backfilling the ledger later.

## Implementation surface

### `bin/claude-meter.mjs`

The top-level `parseArgs` call at `bin/claude-meter.mjs:16` owns flag declarations and forwards a generic `args` object to `ratesCommand`. Add two new options to that `parseArgs` config:

- `by` — `{ type: "string", default: "window" }`. Accepted values: `"window"`, `"row"`. Any other value produces a parse error.
- `tier-start-date` — `{ type: "string" }`. No default. Required when the subcommand is `rates` and `--by window` (the default mode). The dispatch path for `case "rates"` (`bin/claude-meter.mjs:107`) validates presence and format before calling `ratesCommand`; on missing/invalid, exit non-zero with: *"--tier-start-date <YYYY-MM-DD> is required for window-mode regression. Use --by row to skip the v1 window contract (deprecated; produces unreliable weights)."*

The existing `--log-file` global flag (declared at `bin/claude-meter.mjs:28`, documented at `bin/claude-meter.mjs:66`) is currently forwarded only by the `analyze` dispatch (`bin/claude-meter.mjs:122`, `logFile: values["log-file"]`). Extend the `rates` dispatch to forward it the same way (`logFile: values["log-file"]`) so subprocess tests can route fixture data through `bin/claude-meter.mjs` without inventing a new `--fixture` flag. `ratesCommand` reads the resolved log path (falling back to its existing default at `src/cli/rates.mjs:12`-`:13` when unset).

Tests for this parser surface go in `test/rates-windowing.test.mjs` (see §"Tests" below) and execute against the actual `bin/claude-meter.mjs` entrypoint as a subprocess (`spawnSync`-style), not just direct `ratesCommand` calls. The accepted-flag test writes a fixture JSONL to a temp path and invokes `claude-meter rates --tier-start-date 2026-05-23 --log-file <temp>` so the parser, dispatch, and window-mode regression path are all exercised end-to-end.

### `src/log/reader.mjs`

Add `groupByQuotaWindow(rows)` — exported function that returns a `Map<q5h_reset, {rows: WindowRows[], q5h_max: number, q5h_reset: number}>`. Distinct from the existing `filterByQuotaWindow` which returns "the largest single window" for a different consumer (the per-row regression's window-isolation step). The new function does not pick a single window; it returns ALL windows for downstream filtering.

### `src/cli/rates.mjs`

Refactor `ratesCommand` to dispatch on the new `--by <window|row>` flag (default `window`).

- Window-mode path: read rows, filter by `--tier-start-date`, call `groupByQuotaWindow`, apply the four hard-coded filters (`q5h_max ≥ 0.10`, `rows_per_window ≥ 20`, exclude in-progress, single-model windows only). For each `(model|speed)` pair: hold out the most-recent qualifying window, fit OLS on the remainder, compute R² and held-out window prediction error. If fewer than 20 qualifying windows remain for a pair, emit the "Insufficient data" warning above the numbers per §"Mixed-model windows".
- Row-mode path: existing implementation, plus the stderr deprecation notice.
- Cache-fix detection: scan in-scope rows for `agent_id`/`request_id` presence per §"Cache-fix observer-effect labeling", emit the appropriate label.

The OLS machinery (`olsRegression`, `invertMatrix`) is reused unchanged.

### `test/rates-display.test.mjs` and new `test/rates-windowing.test.mjs`

Add a new test file for the window-mode behavior. Tests cover:

1. **Weight recovery (AITL fixture).** Passing the anonymized 90-window fixture through the window-mode regression recovers AITL's expected weights (cache_read=0.0262, cache_create=10.01, input=8.39, output=60.80) to within 5% tolerance and reports R² ≥ 0.70. The AITL fixture is shuffled and chronology-stripped — this test validates weight recovery only, not chronology rules.
2. **Chronology rules (synthetic fixture).** A separate small synthetic fixture (5-10 hand-crafted windows with explicit `q5h_reset` timestamps) exercises the chronology contract: in-progress current window is excluded from the fit; the held-out window is the most-recent QUALIFYING window (not necessarily the literal last entry); "qualifying" means passing all four filters from §"Other filter thresholds". Synthetic data; no real rows.
3. **Mixed-model filter (synthetic fixture).** A synthetic fixture mixes two `(model|speed)` pairs within one window and isolates each pair in others. The mixed window is dropped from both pairs' fit sets; the isolated windows feed each pair's independent regression.
4. **Insufficient-data warning.** A synthetic fixture with fewer than 20 qualifying single-model windows for a `(model|speed)` pair produces the "Insufficient data" warning above the numbers; numbers are still emitted.
5. **CLI parser (subprocess against `bin/claude-meter.mjs`).** `claude-meter rates --by row` returns the legacy per-row regression output AND writes the deprecation notice to stderr; `claude-meter rates` with no `--tier-start-date` produces the required-flag error message and exits non-zero; `claude-meter rates --tier-start-date 2026-05-23` against a fixture flows through to window-mode output.
6. **Cache-fix label.** A fixture with `agent_id` populated on ≥50% of rows emits `cache_fix_active`; with `agent_id`/`request_id` absent from all rows, no label is emitted; with `request_id` on 30% emits `cache_fix_mixed`.

### Fixture: `test/fixtures/aitl-anonymized-90-windows.json`

AITL's 90-window anonymized sample. Each entry: `{ cache_read_M, cache_create_M, input_M, output_M, q5h_max }`. Codex-cleared SAFE_TO_SHIP. Committed to this branch by AITL at 4e68a1e. Used by test #1 above only; chronology fields (q5h_reset, timestamps) intentionally absent per privacy posture.

### Synthetic chronology fixture (proxy-builder-authored)

Construct in-test (or as a tiny JSON file under `test/fixtures/`) — 5-10 windows with explicit `q5h_reset` ISO timestamps, hand-crafted token counts that yield trivially-known weights, deliberately including:
- one in-progress current window (must be excluded)
- one window with rows_per_window < 20 (must be excluded by row-count filter)
- one window with `q5h_max < 0.10` (must be excluded by signal filter)
- one mixed-model window (must be excluded from every `(model|speed)` pair)
- a clear "most-recent qualifying" window distinct from the literal last entry by timestamp

Tests #2, #3, #4 above run against this fixture. No real telemetry; deterministic; lives in-repo.

## Test plan

Beyond the unit tests above:

1. **Regression on AITL's sample** — the fixture test verifies AITL's measured weights to within 5% tolerance. This is the load-bearing acceptance test.
2. **R² floor** — fixture test asserts `R² >= 0.70`. This is the minimum reasonable fit quality on the AITL sample; lower bound chosen to allow ~1% slack vs his measured 0.7148.
3. **Held-out validation** — fixture test asserts held-out window prediction error ≤ 5%. AITL's measured 2.3% is well within this; the floor exists to catch implementation bugs that would cause the held-out error to balloon.
4. **CLI surface** — tests for `--by row` deprecation notice path, `--tier-start-date` required-flag behavior, error messages on no qualifying windows.

## Verification

- `node --test test/rates-windowing.test.mjs test/rates-display.test.mjs` — all green.
- Manual smoke (real installs): `claude-meter rates --tier-start-date 2026-05-23` against the operator's `~/.local/share/claude-meter/usage.jsonl` returns window-mode output. A `--fixture <path>` flag is **not** part of the v1 CLI contract; tests load the AITL fixture by direct file read inside the test harness, not via a user-facing flag.
- Cross-repo no-regression: nothing else depends on `rates` output today; spot-check the meter dashboard at `public/index.html` and `web/src/` doesn't import from `src/cli/rates.mjs`.

## Out of scope

- **Tier-start inference from `q7d` reset** — explicit follow-up, not v1. Required flag is the v1 contract.
- **Weight-history ledger** — that's #34. This directive only commits to "the window-mode fit produces usable weights"; the ledger that records them across time is a separate work item.
- **Drift detection** — also #34. Not in v1.
- **Per-tier auto-detection** — operator-supplied `--tier-start-date` is the v1 contract.
- **Public-share schema for weights** — also #34's later step. The current `share` endpoint accepts the JSONL submission shape and is untouched by this directive.
- **The dashboard at meter.vsits.co rendering recovered weights** — the dashboard doesn't render `rates` output today. If a future PR adds a chart, it consumes whatever the CLI produces; this directive doesn't commit to a dashboard render.

## Process

The contract is narrow enough that this single branch carries the directive doc and the implementation in sequential commits. The directive lands in commit 1; implementation lands in commit 2+. The PR description references this directive at the top, and Codex review on the implementation PR is asked to check against this directive's contract before assessing the code.

If during implementation the contract drifts (e.g., we discover the 50/10% cache-fix-mixed thresholds need tuning, or the `--by row` legacy mode is harder to keep alive than expected), this directive gets an amendment commit on the same branch BEFORE the implementation change.

— Proxy Builder
