APPROVE

# Review: rates history ledger Phase 1 implementation, round 2

Date: 2026-06-19
Reviewed: PR #37 (`feature/rates-history-ledger-phase1` at `5b7b9a0399b72a46ca8f00cd674ef974a2e95758`) against locked directive `docs/directives/rates-history-ledger.md`
Round: 2
Label applied: approved-by-codex-agent

Blocker resolved. The `--refit` dispatch now defines the accepted plan set exactly as the directive's tier identity contract requires (`pro`, `max-5x`, `max-20x`, `api`, `unknown`) at `bin/claude-meter.mjs:16`-`19`, matching `docs/directives/rates-history-ledger.md:152`. The invalid-plan check runs inside the `values.refit` branch after the existing presence check and before the dynamic import/call to `ratesCommand`, so `ratesCommand` cannot read the log or reach `runRefit`/`appendFit` for `--plan banana`: `bin/claude-meter.mjs:138`-`160`, `bin/claude-meter.mjs:175`-`185`, `src/cli/rates.mjs:22`-`37`, `src/cli/rates.mjs:276`-`290`. I also confirmed by grep that this is the first actual `--plan` value constraint; the validation is load-bearing and not duplicate/dead code.

AI #1 resolved. The successful `--refit` subprocess test now pins the complete ledger weight-key contract with `Object.keys(fit.weights).sort()` equal to `["cache_create", "cache_read", "input", "output"]`, then separately asserts each value is numeric: `test/rates-history-ledger-phase1.test.mjs:156`-`169`. That assertion would fail on row-field names such as `cache_creation_input_tokens` and on display-label names such as `Cache Write`, so the storage/display/row-field split from `docs/directives/rates-history-ledger.md:87`-`99` is now covered.

Regression coverage for the blocker is present and meaningful. The new subprocess test invokes `rates --refit --plan banana`, asserts a non-zero exit, checks stderr names `"banana"`, and verifies the ledger file does not exist after the failed command: `test/rates-history-ledger-phase1.test.mjs:176`-`190`.

No regression found in the previously correct Phase 1 surfaces. The ledger module still returns an empty v1 ledger for missing files, preserves existing entries on append, filters by conjunction, and rejects future schema versions: `src/cli/weights-ledger.mjs:17`-`53`. The window-mode refactor still routes through `buildPairs`, `fitPair`, and `renderFit`; `runRefit` still renders every pair but appends only `status: "ok"` fits with the four required storage keys; `runHistory` remains read-only and sorts newest-first: `src/cli/rates.mjs:50`-`75`, `src/cli/rates.mjs:83`-`240`, `src/cli/rates.mjs:246`-`333`. Verification: `node --test test/*.test.mjs` passed with 119 tests, 119 passing, 0 failing.

Bottom line: approve. The round 1 blocker and storage-key test gap are fixed without expanding the implementation surface, and the full visible suite passes at the expected count.
