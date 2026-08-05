APPROVE

# Review: rates-history-ledger Phase 4 directive r2

Date: 2026-06-19
Reviewed: PR #41 directive `docs/directives/rates-history-ledger-phase4.md` at `1d0c1f9`
Round: 2
Label applied: `reviewed-by-codex-agent`

Blocker resolved. The submission scope is now consistently full-history across the lock, dedup rationale, payload, and opt-in semantics: §2 says full-history resubmission is idempotent server-side, §5 says the client sends all in-scope fits up to the cap and tracks no `last_submitted_at`, and opt-in semantics explicitly say every publish path reads the ledger after append and sends the full capped in-scope history, not a delta (`docs/directives/rates-history-ledger-phase4.md:73`, `docs/directives/rates-history-ledger-phase4.md:91`, `docs/directives/rates-history-ledger-phase4.md:117`-`122`). The only remaining "just the new fits" language is in the revision-history description of the old r1 contradiction, where it is explicitly marked resolved (`docs/directives/rates-history-ledger-phase4.md:12`).

AI #1 resolved. The 100-fit cap now has a deterministic total ordering: sort by `fit_at` descending, then `tier`, `model`, and `speed` ascending before taking the first 100, which removes the same-`fit_at` cap-boundary ambiguity from a single `runRefit` invocation (`docs/directives/rates-history-ledger-phase4.md:77`-`79`).

AI #2 resolved. The threat model now explicitly names `--endpoint` as a consent-token exfiltration path, states that operator-supplied endpoints receive both `consent_token` and `install_id`, and gives the acceptance rationale: explicit operator flag, existing `analyze --share` precedent, and no untrusted-input injection path (`docs/directives/rates-history-ledger-phase4.md:35`-`40`).

AI #3 resolved. The 4xx rule no longer requires blindly printing a reflected raw body: it prefers the server `error` string and requires replacing any reflected operator consent-token substring in raw output with `consent_token=<redacted>` before printing (`docs/directives/rates-history-ledger-phase4.md:83`-`87`, `docs/directives/rates-history-ledger-phase4.md:140`).

AI #4 resolved. The directive now separates explicit operator requests from scheduled background publishes: explicit `--share-weights` with missing consent prints "Run `claude-meter consent` to publish weights.", exits non-zero, and makes no network call, while scheduled auto-publish under `weights_share_enabled` silently skips after revocation (`docs/directives/rates-history-ledger-phase4.md:64`-`69`, `docs/directives/rates-history-ledger-phase4.md:135`).

AI #5 resolved. The config test seam is now concrete: add defaulted path parameters to private `readConfig(path = CONFIG_FILE)` / `writeConfig(config, path = CONFIG_FILE)`, thread that through the consent helpers used by the weights path, expose a test-only `--config-file`, and keep production behavior on the default `CONFIG_FILE` path (`docs/directives/rates-history-ledger-phase4.md:142`-`144`). Spot-check: current `readConfig`/`writeConfig` are private and hard-bound to `CONFIG_FILE`, and Phase 1 already uses the analogous `readLedger(path = HISTORY_FILE)` default-parameter pattern (`src/consent.mjs:53`-`65`, `src/constants.mjs:20`-`22`, `src/cli/weights-ledger.mjs:17`).

Nit resolved. The endpoint-path-constants claim is narrowed correctly: `MESSAGES_ENDPOINT = "/v1/messages"` is acknowledged as the upstream Anthropic path, while community API paths remain hard-coded at call sites and the new weights path follows that pattern (`docs/directives/rates-history-ledger-phase4.md:54`, `src/constants.mjs:29`).

No new contradictions found. The revised full-history language agrees with the 100-fit cap, dedup key, wire payload, and opt-in semantics; the revoked-consent split agrees with the token-source spec; and the amendment commit itself touches only `docs/directives/rates-history-ledger-phase4.md`.

Bottom line: approve the directive r2 fold. This is still a load-bearing wire contract, so this Codex approval does not satisfy the required Chris human review before merge.
