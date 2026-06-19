Verdict: REQUEST_CHANGES

# Review: rates history ledger master directive

Date: 2026-06-19
Reviewed: `docs/directives/rates-history-ledger.md` at `91fa1f2a6ed6962cc44534bf9ec92e2ef84955ea`
Round: 2
Label applied: `changes-requested`

## R1 Finding Resolution

1. **B1 storage root: Partially resolved.**

   The main path contract now uses the repo's canonical root: `~/.claude/claude-meter-history.json` is named at `docs/directives/rates-history-ledger.md:82`, and `~/.claude/claude-meter-drift-seen` is named at `docs/directives/rates-history-ledger.md:190`. Both are claimed as new `src/constants.mjs` exports at those same lines. No residual `~/.local/share/claude-meter` body references remain outside the revision-history explanation at `docs/directives/rates-history-ledger.md:12`.

   However, the Phase 2 implementation surface still tells implementers to check `last-drift-seen.txt` at `docs/directives/rates-history-ledger.md:204`, which contradicts the locked `DRIFT_SEEN_FILE` name. That keeps the storage contract partially unresolved.

2. **B2 consent persistence/auth shape: Partially resolved.**

   Phase 4 now names `CONFIG_FILE` and `~/.claude/claude-meter-config.json` for `weights_share_enabled: boolean` at `docs/directives/rates-history-ledger.md:300`, and tests assert the same persistence file at `docs/directives/rates-history-ledger.md:319`. The wire skeleton includes `consent_token` at `docs/directives/rates-history-ledger.md:277`, and the minimum contract list includes auth/consent fields at `docs/directives/rates-history-ledger.md:289`.

   The remaining problem is the amendment's auth wording. It says `getConsentStatus()` already returns a `consent_token` field at `docs/directives/rates-history-ledger.md:13`, but the actual function returns `token`, `timestamp`, and `installId` after validating `config.consent_token`: `src/consent.mjs:102`, `src/consent.mjs:107`, `src/consent.mjs:110` through `src/consent.mjs:115`. The existing analyze-share path does post the outgoing JSON field as `consent_token` at `src/cli/analyze.mjs:744` through `src/cli/analyze.mjs:773`; the directive should distinguish the config/payload field from the function return property.

3. **B3 tier flag: Partially resolved.**

   The directive now uses `--plan`, not `--tier`, for the CLI flag at `docs/directives/rates-history-ledger.md:134`, `docs/directives/rates-history-ledger.md:136`, and `docs/directives/rates-history-ledger.md:138`. It lists the accepted values `pro`, `max-5x`, `max-20x`, `api`, and `unknown` at `docs/directives/rates-history-ledger.md:142`, requires `--plan` for `--refit` at `docs/directives/rates-history-ledger.md:138`, and adds missing-plan test 6b at `docs/directives/rates-history-ledger.md:160`.

   The contract is still internally inconsistent because the example ledger entry uses `tier: "max-2x"` at `docs/directives/rates-history-ledger.md:105`, and phase-1 subprocess test 6 uses `--plan max-2x` at `docs/directives/rates-history-ledger.md:159`. `max-2x` is not one of the CLI's documented accepted values at `bin/claude-meter.mjs:65`, so a compliant implementation/test would be aimed at an invalid plan value.

4. **AI #1 phase 3 default behavior/gate scope: Partially resolved.**

   The directive now requires explicit output lines for scheduled refit and tier transition at `docs/directives/rates-history-ledger.md:228` through `docs/directives/rates-history-ledger.md:231`. It also adds a Gate scope section that excludes `--refit`, `--history`, `--dismiss-drift`, `--by row`, and `--skip-scheduled-refit` from the cadence trigger at `docs/directives/rates-history-ledger.md:233` through `docs/directives/rates-history-ledger.md:241`.

   The Phase 3 goal still says the gate fires when the operator runs "ANY `rates` command" at `docs/directives/rates-history-ledger.md:221`, which contradicts the new scope section. This is no longer ambiguous enough to be a standalone blocker, but it should be cleaned up before phase implementation.

5. **AI #2 drift-dismiss semantics: Resolved.**

   The new Banner-decision algorithm is explicit and ordered at `docs/directives/rates-history-ledger.md:192` through `docs/directives/rates-history-ledger.md:197`. Step 3 short-circuits on `drifted === false` before reading `DRIFT_SEEN_FILE`, and the follow-on text makes the per-fit dismiss semantics clear at `docs/directives/rates-history-ledger.md:199`.

6. **AI #3 schema version reader behavior: Resolved.**

   Missing `schema_version` is treated as 1, and future versions are rejected with a clear error per `docs/directives/rates-history-ledger.md:17`. Test 6c locks both behaviors at `docs/directives/rates-history-ledger.md:161`.

7. **AI #4 phase 4 minimum wire contract: Resolved.**

   The minimum lock list now covers auth/consent fields, idempotency/dedup key, max payload size, server error handling, submission scope, and response shape at `docs/directives/rates-history-ledger.md:285` through `docs/directives/rates-history-ledger.md:294`.

8. **AI #5 `weights-share.mjs` module decision: Resolved.**

   The maintainability section and Phase 4 implementation surface now both choose `src/cli/weights-share.mjs` as a new module, with the same rationale: `/api/v1/weights` has a distinct endpoint and payload from `src/cli/share.mjs`'s `/api/v1/submit` path. See `docs/directives/rates-history-ledger.md:67` and `docs/directives/rates-history-ledger.md:305`.

9. **N1 vocabulary mapping: Resolved.**

   The directive now includes the requested table mapping ledger storage keys to JSONL row fields and display labels, including `input`, `output`, `cache_read`, and `cache_create`, at `docs/directives/rates-history-ledger.md:84` through `docs/directives/rates-history-ledger.md:95`.

## Cross-Check Against Repo State

- `src/constants.mjs:20` confirms `CLAUDE_DIR = join(homedir(), ".claude")`; the storage-root fix is directionally honest.
- `src/consent.mjs:16`, `src/consent.mjs:55`, and `src/consent.mjs:64` confirm consent/config persistence uses `CONFIG_FILE`.
- `bin/claude-meter.mjs:22` and `bin/claude-meter.mjs:65` confirm the flag is `--plan` and the documented values are `pro`, `max-5x`, `max-20x`, `api`, and `unknown`.
- `src/cli/analyze.mjs:744` through `src/cli/analyze.mjs:773` confirms the current share path posts a payload field named `consent_token`.

## New Blockers

1. **The amendment miscites the consent return shape.**

   `docs/directives/rates-history-ledger.md:13` says auth uses an existing `consent_token` field returned by `getConsentStatus()`. The actual return shape is `{ consented: true, token, timestamp, installId }` at `src/consent.mjs:110` through `src/consent.mjs:115`. This is a repo-state mismatch in the amendment itself. The correct contract can still use a payload field named `consent_token`, but the directive must say it is sourced from the existing consent token/config or from `status.token`, not from a `getConsentStatus().consent_token` property.

## Cross-Phase Dependency Check

Phase 2 still names the Phase 1 ledger as the source for banner decisions at `docs/directives/rates-history-ledger.md:192` through `docs/directives/rates-history-ledger.md:197`. Phase 4 still names the consent module extension at `docs/directives/rates-history-ledger.md:300` and `docs/directives/rates-history-ledger.md:307`. Phase 3's interaction with Phase 2 is implied by "print the new fit + any drift warning" at `docs/directives/rates-history-ledger.md:228`, but it does not explicitly reference the Phase 2 banner-decision algorithm; fold this while cleaning up the remaining Phase 3 wording.

## Bottom Line

Revise once more before implementation. The r2 amendment fixed the major direction of the contract, but there are still load-bearing contradictions in the directive text: the drift-dismiss file name is inconsistent, the `--plan` example/test uses an invalid plan value, and the consent-token citation does not match the actual `getConsentStatus()` return shape. These are small edits, but they are contract edits, and implementation should not start until they are unambiguous.
