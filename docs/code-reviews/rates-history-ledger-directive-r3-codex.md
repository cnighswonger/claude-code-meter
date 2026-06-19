Verdict: APPROVE

# Review: rates history ledger master directive freshness verification

Date: 2026-06-19
Reviewed: `docs/directives/rates-history-ledger.md` at `61af6b0592289daf27389aea9e1ca6ef19a7f480`
Round: 3
Label applied: `reviewed-by-codex-agent`

## R2 Item Resolution

1. **B1 residual: Resolved.**

   Phase 2 now locks the drift-dismiss path as `~/.claude/claude-meter-drift-seen` and explicitly names `DRIFT_SEEN_FILE` as the constants export at `docs/directives/rates-history-ledger.md:195`. The Phase 2 implementation surface tells `runWindowMode` to check `DRIFT_SEEN_FILE`, not `last-drift-seen.txt`, at `docs/directives/rates-history-ledger.md:209`. The only remaining `last-drift-seen.txt` reference is in the r2 -> r2.1 revision-history entry describing the resolved bug at `docs/directives/rates-history-ledger.md:22`, which is legitimate history text.

2. **B2 consent return/wire shape: Resolved.**

   Phase 4 now distinguishes the outgoing wire field from the source value: the payload skeleton uses `"consent_token"` at `docs/directives/rates-history-ledger.md:282`, while the explanatory text says the token string comes from either `requestConsent(args.yes)` or `getConsentStatus().token` at `docs/directives/rates-history-ledger.md:288`. The revision-history block correctly states that `getConsentStatus()` returns `{consented, token, timestamp, installId}` and not a `consent_token` property at `docs/directives/rates-history-ledger.md:13` and `docs/directives/rates-history-ledger.md:23`.

   Repo-state cross-check: `src/consent.mjs:102` through `src/consent.mjs:117` returns `token`, `timestamp`, and `installId` after validating `config.consent_token`; `src/consent.mjs:128` through `src/consent.mjs:178` confirms `requestConsent()` returns the token string; `src/cli/analyze.mjs:744` through `src/cli/analyze.mjs:773` confirms the existing share path writes that string to the `consent_token` payload field.

3. **B3 invalid plan value: Resolved.**

   The ledger example now uses `"tier": "max-20x"` at `docs/directives/rates-history-ledger.md:110`, and phase-1 test 6 now uses `--plan max-20x` at `docs/directives/rates-history-ledger.md:164`. The accepted-value contract names `max-20x` at `docs/directives/rates-history-ledger.md:147`, matching the CLI help at `bin/claude-meter.mjs:65`. The only remaining `max-2x` reference is in the r2 -> r2.1 revision-history entry describing the resolved bug at `docs/directives/rates-history-ledger.md:24`, which is legitimate history text.

4. **AI #1 cleanup: Resolved.**

   The Phase 3 goal now says the scheduled-refit gate fires only on the default-mode `rates` invocation and points readers to the Gate scope section at `docs/directives/rates-history-ledger.md:226`. The Gate scope section independently lists the excluded invocation forms at `docs/directives/rates-history-ledger.md:238` through `docs/directives/rates-history-ledger.md:248`. The prior "ANY `rates` command" contradiction is gone.

5. **Cross-phase dependency: Resolved.**

   Phase 2's implementation surface now explicitly says the Phase 3 cadence path reuses the same Phase 2 banner-decision algorithm at `docs/directives/rates-history-ledger.md:209`, and the algorithm itself is defined at `docs/directives/rates-history-ledger.md:197` through `docs/directives/rates-history-ledger.md:204`.

## Remaining Blockers

None.

## Bottom Line

The r2.1 fold is real and complete. The directive now matches the checked repo state for the consent return shape, existing `consent_token` wire field, documented plan values, drift-dismiss constant, Phase 3 gate scope, and Phase 2/Phase 3 banner dependency. Approve for directive-stage continuation.
