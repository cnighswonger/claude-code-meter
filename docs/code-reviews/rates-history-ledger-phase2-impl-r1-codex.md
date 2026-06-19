REQUEST_CHANGES

# Review: rates history ledger Phase 2 implementation, round 1

Date: 2026-06-19
Reviewed: PR #39 (`feature/rates-history-ledger-phase2` at `734f6e7f3543535b04318cdd783a589fbbbd89b6`) against locked directive `docs/directives/rates-history-ledger.md`
Round: 1
Label applied: changes-requested

## Findings

### Blockers

1. The drift banner does not emit the directive's hard-coded summary sentence exactly. The locked Phase 2 output format requires `Workloads that were quota-efficient last month may now burn faster.` and explicitly calls that sentence hard-coded, but `driftBannerLines()` prints `Workloads that were quota-efficient last period may now burn faster.` instead. This is an output-contract mismatch in the load-bearing drift-warning surface, not a wording preference. See `docs/directives/rates-history-ledger.md:182`-`196` and `src/cli/rates.mjs:381`-`399`.

### Attention Items

1. The tests do not prove the load-bearing step-3-before-step-4 semantic. `maybePrintPendingDriftBanner()` correctly computes drift and returns before reading the seen file when `drifted` is false (`src/cli/rates.mjs:426`-`429`), matching the directive's required ordering (`docs/directives/rates-history-ledger.md:202`-`209`). However, the subprocess coverage only checks refit banner, next default banner, and dismiss suppression (`test/rates-history-ledger-phase2.test.mjs:107`-`193`). There is no regression test for a later non-drift most-recent fit with a stale/old seen timestamp still producing no banner.

2. The dismiss test does not verify a fresh later drift re-shows. The test confirms the seen file exists, suppresses the current fit's banner, and contains an ISO-like timestamp (`test/rates-history-ledger-phase2.test.mjs:158`-`189`), but the directive's named case says suppression lasts "until the next drift event" (`docs/directives/rates-history-ledger.md:226`). A second appended drift with a new `fit_at` would pin that per-fit marker behavior.

3. The banner header currently includes the full prior `fit_at` timestamp, while the directive example shows a date-only parenthetical. This is less critical than the hard-coded summary sentence because the algorithm stores and compares full ISO `fit_at` values, but if the output example is intended as exact formatting, `src/cli/rates.mjs:384` should format `prior.fit_at` to the display date shown in `docs/directives/rates-history-ledger.md:184`-`193`.

### Nits

1. `--drift-seen-file` is a reasonable test-injection flag. It mirrors the existing `--ledger-file` path injection and is passed only into the rates command (`bin/claude-meter.mjs:41`-`44`, `bin/claude-meter.mjs:180`-`192`), so I do not see a bloat or user-surface blocker.

## What Is Correct

`computeDrift(prevFit, currentFit, thresholdPct = 15)` returns the contracted shape, returns `{ drifted: false, items: [] }` for a missing prior fit, emits all four canonical weight keys, computes change relative to `Math.abs(prev)`, and uses a strict `> thresholdPct` crossing check so exactly 15.0% does not cross (`src/cli/weights-ledger.mjs:56`-`97`). The `prev === 0` branch treats nonzero current values as infinite relative change, and the banner renders non-finite percentages as `new` rather than leaking `Infinity%` or `NaN` (`src/cli/weights-ledger.mjs:81`-`93`, `src/cli/rates.mjs:390`-`394`).

The default banner-decision control flow matches the directive: it reads the ledger, selects the most-recent fit by ISO lexical ordering, filters priors to the same `(tier, model, speed)`, computes drift, returns before dotfile access when no drift is present, and only then consults the seen file (`src/cli/rates.mjs:411`-`432`; directive at `docs/directives/rates-history-ledger.md:202`-`209`). The `runRefit()` path captures the prior matching fit before `appendFit()`, so it does not compare the newly built entry to itself (`src/cli/rates.mjs:282`-`327`).

The dismiss path is dotfile-only: `ratesCommand()` exits into `runDismissDrift()` before log loading or regression (`src/cli/rates.mjs:23`-`36`), and the CLI validation bypasses `--tier-start-date`, `--plan`, and `--by` checks for `--dismiss-drift` just as it does for `--history` (`bin/claude-meter.mjs:136`-`180`). `runDismissDrift()` writes the most-recent fit's `fit_at` to the drift-seen file (`src/cli/rates.mjs:435`-`458`).

The banner row order matches the directive example: `cache_read`, `cache_create`, `input`, `output` (`src/cli/rates.mjs:370`-`395`; directive at `docs/directives/rates-history-ledger.md:184`-`193`). The warning marker is emitted only when `crossed_threshold` is true (`src/cli/rates.mjs:390`-`394`).

No warning subsystem was introduced. The implementation is local to `computeDrift()` plus local CLI helpers in the rates command (`src/cli/weights-ledger.mjs:56`-`97`, `src/cli/rates.mjs:368`-`458`), and Phase 3 can reuse `maybePrintPendingDriftBanner()` without duplicating the algorithm in another module (`src/cli/rates.mjs:402`-`432`).

## Verification

`node --test test/rates-history-ledger-phase2.test.mjs` passed: 6 tests, 6 passing.

`npm test` passed: 125 tests, 125 passing.

## Bottom Line

Request changes for the exact hard-coded summary sentence mismatch. The implementation otherwise follows the Phase 2 algorithm and CLI contract closely; after fixing the sentence, the remaining items are coverage/format nits rather than blockers.
