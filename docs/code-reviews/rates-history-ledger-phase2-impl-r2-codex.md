APPROVE

# Review: rates history ledger Phase 2 implementation, round 2

Date: 2026-06-19
Reviewed: PR #39 (`feature/rates-history-ledger-phase2` at `0c75d8d`)
Round: 2
Label applied: approved-by-codex-agent

Blocker resolved: `driftBannerLines()` now emits the directive's exact hard-coded sentence, `Workloads that were quota-efficient last month may now burn faster.`, matching `docs/directives/rates-history-ledger.md:192` character-for-character. The prior paraphrase does not remain in `src/cli/rates.mjs`; the sentence is pinned in implementation and the subprocess test at `test/rates-history-ledger-phase2.test.mjs:122`-`124`.

AI #1 resolved: the new subprocess test at `test/rates-history-ledger-phase2.test.mjs:234`-`249` constructs a most-recent non-drift pair where all weights are under the 15% threshold, writes a stale unrelated seen-file timestamp, and asserts that no `DRIFT DETECTED` banner prints. That directly covers the step-3-before-step-4 short-circuit.

AI #2 resolved: the new subprocess test at `test/rates-history-ledger-phase2.test.mjs:255`-`275` records a dismissed first drift event's full `fit_at`, then makes a newer most-recent fit drift from that prior event and verifies the banner re-shows. The seen timestamp is event A and the active drift is event B, so the per-fit dismiss behavior is covered.

AI #3 resolved: the banner header now slices the prior fit's `fit_at` to `YYYY-MM-DD` for display only in `src/cli/rates.mjs:381`-`387`, and the tightened refit-banner test asserts both the date-only header and the absence of the full ISO header at `test/rates-history-ledger-phase2.test.mjs:125`-`127`. Internal storage and comparison remain full ISO: most-recent/prior selection compares full `fit_at` values in `src/cli/rates.mjs:373`-`377` and `src/cli/rates.mjs:422`-`428`; dismiss suppression still compares `readDriftSeen(args) === current.fit_at` at `src/cli/rates.mjs:430`-`433`; dismiss writes `current.fit_at` at `src/cli/rates.mjs:439`-`447`.

No regression confirmed: `node --test test/*.test.mjs` passed with 127 tests, 127 passing. The already-correct r1 surfaces remain intact: `computeDrift()` still returns the contracted shape, uses strict `> 15` crossing, handles `prev === 0` as a new crossing, and preserves canonical row order in `src/cli/weights-ledger.mjs:56`-`97`; the banner-decision ordering and dotfile-only dismiss path remain unchanged in `src/cli/rates.mjs:23`-`27` and `src/cli/rates.mjs:415`-`437`.

Bottom line: approve. The blocker and all three attention items are resolved, and the date-only formatting change is display-only rather than a regression in fit identity.
