Verdict: REQUEST_CHANGES

# Review: rates history ledger Phase 1 implementation

Date: 2026-06-19
Reviewed: PR #37 (`feature/rates-history-ledger-phase1` at `09ffd3e8024ce0927effa349dbbd723efe48003f`) against locked directive on `main` (`63cc0b99a852fa5d7173541373f114df7bcf71fd`)
Round: 1
Label applied: changes-requested

## Findings

### Blockers

1. `rates --refit` accepts and persists unsupported plan/tier values.

   The locked directive says the ledger `tier` comes from `--plan`, and accepted values are limited to `pro`, `max-5x`, `max-20x`, `api`, and `unknown`; any other value must fail at parser time: `docs/directives/rates-history-ledger.md:150`, `docs/directives/rates-history-ledger.md:152`. The implementation only checks that `--plan` is present, not that it is one of the accepted values: `bin/claude-meter.mjs:142`, `bin/claude-meter.mjs:148`. `runRefit` then writes `tier: args.plan` directly into the ledger: `src/cli/rates.mjs:276`, `src/cli/rates.mjs:279`. This lets `claude-meter rates --refit --plan banana ...` append a fit under an invalid tier key, which breaks Phase 2's same-`(tier, model, speed)` comparison substrate before it ships. Add parser-time validation for `--plan` on the `--refit` path and a subprocess regression test for an invalid plan.

### Attention Items

1. The Phase 1 test suite does not assert the full storage-key contract.

   The directive's ledger mapping explicitly requires storage keys `input`, `output`, `cache_read`, and `cache_create`: `docs/directives/rates-history-ledger.md:91`, `docs/directives/rates-history-ledger.md:99`. The subprocess `--refit` test reads the on-disk ledger, but it only asserts that `weights.cache_create` is numeric: `test/rates-history-ledger-phase1.test.mjs:156`, `test/rates-history-ledger-phase1.test.mjs:165`. The implementation currently writes all four correct keys in the right aggregate-token order: `src/cli/rates.mjs:285`, `src/cli/rates.mjs:290`, and `aggregateTokens` returns `[input, output, cacheRead, cacheCreate]`: `src/cli/rates.mjs:359`, `src/cli/rates.mjs:373`. This is not a blocker because the code is correct, but the test should pin all four keys so a later display-label or row-field-name regression is caught.

2. Phase 1 is over the nominal size budget, mostly due to the compute/render refactor.

   The directive budgets Phase 1 at roughly 80 implementation LOC and 80 test LOC, with material drift past 2x worth flagging: `docs/directives/rates-history-ledger.md:44`, `docs/directives/rates-history-ledger.md:45`. The size increase is visible in the new ledger module and subprocess-heavy test file, plus the `rates.mjs` helper split: `src/cli/weights-ledger.mjs:1`, `test/rates-history-ledger-phase1.test.mjs:1`, `src/cli/rates.mjs:83`, `src/cli/rates.mjs:246`. I do not see a new service layer, scheduler, or warning subsystem; the extra implementation size comes from extracting `buildPairs`, `fitPair`, and `renderFit` so `runRefit` can append only successful fits: `src/cli/rates.mjs:83`, `src/cli/rates.mjs:113`, `src/cli/rates.mjs:173`, `src/cli/rates.mjs:246`. Treat this as acceptable refactor churn if the invalid-plan blocker is fixed, but avoid expanding the surface further in Phase 1.

### Nits

1. `--ledger-file` is a test-injection surface; keep it intentionally quiet.

   The new parser flag is user-reachable: `bin/claude-meter.mjs:36`, but it is not documented in help while `--log-file` is documented: `bin/claude-meter.mjs:74`, `bin/claude-meter.mjs:82`. The tests use `--ledger-file` to isolate subprocess state: `test/rates-history-ledger-phase1.test.mjs:150`, `test/rates-history-ledger-phase1.test.mjs:215`. That mirrors the existing `--log-file` pattern enough for testability, and keeping it out of help avoids making it a prominent production contract. No change required.

## What Is Correct

- The ledger path matches the directive. `HISTORY_FILE` is `join(CLAUDE_DIR, "claude-meter-history.json")`, with `CLAUDE_DIR` rooted at `~/.claude`: `src/constants.mjs:20`, `src/constants.mjs:25`.
- `readLedger` returns an empty v1 ledger for an absent file, treats missing `schema_version` as v1, and throws a clear future-version error naming the unsupported version: `src/cli/weights-ledger.mjs:17`, `src/cli/weights-ledger.mjs:28`. The tests cover absent, populated, missing-version, and future-version reads: `test/rates-history-ledger-phase1.test.mjs:22`, `test/rates-history-ledger-phase1.test.mjs:38`, `test/rates-history-ledger-phase1.test.mjs:87`, `test/rates-history-ledger-phase1.test.mjs:98`.
- `appendFit` preserves prior entries by reading the current ledger, pushing the new fit, and writing the full object back in one `writeFileSync`: `src/cli/weights-ledger.mjs:36`, `src/cli/weights-ledger.mjs:40`. The append-preservation test verifies two entries remain ordered: `test/rates-history-ledger-phase1.test.mjs:60`, `test/rates-history-ledger-phase1.test.mjs:69`.
- `filterFits` ANDs tier/model/speed filters and treats omitted filters as match-all: `src/cli/weights-ledger.mjs:47`, `src/cli/weights-ledger.mjs:53`. The unit test covers tier-only, tier+model, omitted filters, and no-match cases: `test/rates-history-ledger-phase1.test.mjs:75`, `test/rates-history-ledger-phase1.test.mjs:84`.
- The risky window-mode refactor preserves the branch table: no rows after tier start, no quota windows, no qualifying single-model windows, no qualifying windows for a pair, too few windows, singular matrix, low-confidence warning, R-squared/held-out output, relative weights, known API ratios, and raw weights are still emitted on the corresponding paths: `src/cli/rates.mjs:50`, `src/cli/rates.mjs:74`, `src/cli/rates.mjs:173`, `src/cli/rates.mjs:239`. The existing windowing tests still pass, including chronology, mixed-model filtering, insufficient-data warning, and CLI parser paths.
- `runRefit` renders every pair but appends only `status: "ok"` fits, so no-qualifying, too-few, and singular cases do not poison the ledger: `src/cli/rates.mjs:271`, `src/cli/rates.mjs:274`.
- The persisted fit shape carries Phase 2's required substrate: `fit_at`, `tier`, `tier_started`, `model`, `speed`, `window_count`, `rows_total`, `r_squared`, four-key `weights`, validation details, and `cache_fix_label`: `src/cli/rates.mjs:276`, `src/cli/rates.mjs:298`.
- `rates --history` is read-only, skips log loading, filters by `--plan` and `--model`, and sorts ISO timestamps newest-first: `src/cli/rates.mjs:22`, `src/cli/rates.mjs:27`, `src/cli/rates.mjs:307`, `src/cli/rates.mjs:317`.

## Verification

- `npm test -- --test-reporter=spec test/rates-history-ledger-phase1.test.mjs` passed. Because the package test script appends `test/*.test.mjs`, this ran the full visible test suite plus the named Phase 1 file: 118 passing tests.
- `git diff --check origin/main...HEAD` passed with no whitespace errors.

## Bottom Line

Request changes for the unsupported-plan persistence bug. The ledger module, fit shape, history display, append-only behavior, and refactor structure are otherwise aligned with the Phase 1 contract, and the current shape is suitable for Phase 2 once tier values are constrained to the locked identity set.
