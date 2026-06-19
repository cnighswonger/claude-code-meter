REQUEST_CHANGES

# Review: rates history ledger Phase 3 implementation

Date: 2026-06-19
Reviewed: PR #40 implementation commit `1d5de64`
Round: 1
Label applied: `changes-requested`

## Findings

### Blockers

1. Tier-transition drift suppression is incomplete when the operator transitions back to a previously seen tier.

   The locked contract says a tier transition, detected when the supplied `--tier-start-date` or `--plan` differs from the ledger's most-recent `tier_started` / `tier`, must refit immediately and suppress drift detection because the transition starts a new fit history: `docs/directives/rates-history-ledger.md:240`, `docs/directives/rates-history-ledger.md:273`. The implementation detects that transition against the most-recent overall fit and calls `runRefit(rows, args, { suppressDrift: true })`: `src/cli/rates.mjs:486`, `src/cli/rates.mjs:493`, `src/cli/rates.mjs:500`.

   That suppresses only the banner emitted inside `runRefit`. After returning, the default path always calls `maybePrintPendingDriftBanner(args)`: `src/cli/rates.mjs:58`, `src/cli/rates.mjs:64`. That downstream banner recomputes drift between the newly appended most-recent fit and the prior same `(tier, model, speed)` fit: `src/cli/rates.mjs:428`, `src/cli/rates.mjs:431`, `src/cli/rates.mjs:439`, `src/cli/rates.mjs:444`. If the ledger already has an older fit for the tier being switched back to, the tier-transition invocation still prints a drift banner, violating the required zero-banner transition behavior.

   I verified this with a local smoke: ledger entries `max-20x` old fit, then `max-5x` most-recent fit; invoking default `rates --plan max-20x --tier-start-date 2026-05-23` prints `Tier transition detected ...` and one `DRIFT DETECTED` banner. The current Phase 3 tier-transition test does not catch this because its fixture has only a prior different-tier fit and no older same-tier history: `test/rates-history-ledger-phase3.test.mjs:125`, `test/rates-history-ledger-phase3.test.mjs:131`, `test/rates-history-ledger-phase3.test.mjs:140`, `test/rates-history-ledger-phase3.test.mjs:141`.

### Attention Items

1. The default-mode invalid `--plan` guard is justified, but not pinned by a Phase 3 test.

   Default mode can now write to the ledger via the scheduled refit path, so validating a supplied `--plan` before dispatch is the same safety property as the existing `--refit` guard: `bin/claude-meter.mjs:184`, `bin/claude-meter.mjs:187`, `bin/claude-meter.mjs:192`. The accepted set is the existing Phase 1 set: `bin/claude-meter.mjs:16`, `bin/claude-meter.mjs:19`. This is a reasonable scope extension, not bloat. The remaining gap is coverage: Phase 1 pins invalid `--refit --plan banana`: `test/rates-history-ledger-phase1.test.mjs:176`, but Phase 3 has no default-mode invalid-plan test in `test/rates-history-ledger-phase3.test.mjs:82` through `test/rates-history-ledger-phase3.test.mjs:192`.

2. Gate-scope exclusions are correct in control flow, but only partially tested.

   The cadence gate is reached only after `--dismiss-drift`, `--history`, `--refit`, and `--by row` return: `src/cli/rates.mjs:24`, `src/cli/rates.mjs:31`, `src/cli/rates.mjs:42`, `src/cli/rates.mjs:48`, `src/cli/rates.mjs:58`. The one-shot opt-out returns inside the gate before ledger inspection or refit: `src/cli/rates.mjs:477`, `src/cli/rates.mjs:478`. The tests pin `--skip-scheduled-refit`: `test/rates-history-ledger-phase3.test.mjs:176`, but do not cover `--refit`, `--history`, `--dismiss-drift`, or `--by row` against accidental future movement of the gate.

3. The exact 28.0-day boundary is not tested.

   The implementation uses the correct inclusive comparison, `ageDays >= CADENCE_DAYS`, and ISO timestamps from `fit_at` are parsed through `Date.parse`: `src/cli/rates.mjs:461`, `src/cli/rates.mjs:514`, `src/cli/rates.mjs:515`. The named stale-fit test uses a 30-day-old fit rather than exactly 28.0 days: `test/rates-history-ledger-phase3.test.mjs:111`, `test/rates-history-ledger-phase3.test.mjs:114`, `test/rates-history-ledger-phase3.test.mjs:118`.

### Nits

1. The Phase 3 tests are materially larger than the directive budget, but the extra size is mostly fixture setup and the Phase 2/3 interaction test.

   The directive budget is approximately 60 implementation LOC and 60 test LOC, with review concern when a phase drifts materially past 2x: `docs/directives/rates-history-ledger.md:58`, `docs/directives/rates-history-ledger.md:60`. This PR adds 78 implementation lines and 192 test lines across the review target files. The implementation stays near budget and remains an inline ledger-age gate, not a scheduler subsystem: `src/cli/rates.mjs:459`, `src/cli/rates.mjs:477`, `src/cli/rates.mjs:523`. The test size is over 2x but still focused; I would not block on size alone.

## What Is Correct

- The normal default-mode cadence gate is in the right place: after read-only and explicit-mode returns, before pending drift and window output: `src/cli/rates.mjs:24`, `src/cli/rates.mjs:31`, `src/cli/rates.mjs:42`, `src/cli/rates.mjs:48`, `src/cli/rates.mjs:58`, `src/cli/rates.mjs:64`, `src/cli/rates.mjs:65`.
- The rolling 28-day logic uses the deferred v1 model rather than plan-renewal-day anchoring: `docs/directives/rates-history-ledger.md:255`, `src/cli/rates.mjs:461`, `src/cli/rates.mjs:514`, `src/cli/rates.mjs:515`. I found no renewal-day anchoring logic in the changed files.
- Empty ledger / no prior tier triggers an initial scheduled fit when both required refit inputs are present: `src/cli/rates.mjs:480`, `src/cli/rates.mjs:484`, `src/cli/rates.mjs:505`, `src/cli/rates.mjs:508`; tested at `test/rates-history-ledger-phase3.test.mjs:82`.
- The normal scheduled-refit drift interaction is correct: scheduled refit suppresses its own `runRefit` banner, then the downstream pending-banner path prints exactly once when the new fit drifted from a prior same-key fit: `src/cli/rates.mjs:266`, `src/cli/rates.mjs:330`, `src/cli/rates.mjs:343`, `src/cli/rates.mjs:520`, `src/cli/rates.mjs:64`; tested at `test/rates-history-ledger-phase3.test.mjs:151`, `test/rates-history-ledger-phase3.test.mjs:169`, `test/rates-history-ledger-phase3.test.mjs:170`.
- Phase 3 did not touch Phase 4 share/consent/wire surfaces. The PR changes only `bin/claude-meter.mjs`, `src/cli/rates.mjs`, and `test/rates-history-ledger-phase3.test.mjs`.

## Verification

- `node --test test/rates-history-ledger-phase3.test.mjs` passed: 6/6.
- `node --test test/*.test.mjs` passed: 133/133.
- Additional local smoke reproduced the blocker: switch back to an older same-tier keyspace after a different-tier most-recent fit prints one `DRIFT DETECTED` banner during a tier-transition invocation.

## Bottom Line

Revise before merge. The core cadence gate is simple and mostly matches the locked Phase 3 contract, but tier-transition drift suppression needs to cover the downstream pending-banner pass as well as `runRefit`'s own banner path.
