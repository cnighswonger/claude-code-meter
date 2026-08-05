Verdict: REQUEST_CHANGES

# Review: rates-history-ledger Phase 4 directive

Date: 2026-06-19
Reviewed: PR #41 directive `docs/directives/rates-history-ledger-phase4.md` at `ad25ccf`, against `main` `087ad9f`
Round: 1
Label applied: `changes-requested`

## Findings

### Blockers

1. **Submission scope is not consistently locked.**

   The directive correctly locks "full-history, server dedupes" in the six-point contract, with the client sending all in-scope fits up to the 100-fit cap and not tracking `last_submitted_at` (`docs/directives/rates-history-ledger-phase4.md:72`-`74`). But the opt-in semantics later say the Phase 3 scheduled-refit path publishes "the fits it just appended" (`docs/directives/rates-history-ledger-phase4.md:104`). That reads as a delta/current-refit publish, not full-history. Because the master directive explicitly required Phase 4 to choose whether `fits` is full ledger or delta-only (`docs/directives/rates-history-ledger.md:300`-`304`), this inconsistency is load-bearing: an implementation agent could satisfy line 104 and violate line 74.

   Required fix: make every publish path say the same thing. If the intended contract is full-history, say the one-shot and persistent paths read the ledger after the new fit has been appended, filter in-scope fits, cap to the 100 most-recent by `fit_at`, and send that full capped set. If the intended contract is "only newly appended fits," then update Section 5, the dedup rationale, tests, and payload language accordingly.

### Attention Items

1. **The 100-fit cap needs a deterministic tie-breaker.**

   `runRefit` computes one `fitAt` before iterating all `(model, speed)` fit pairs, so every successful fit produced by a single refit invocation shares the same `fit_at` (`src/cli/rates.mjs:296`-`305`). The dedup key remains safe because it also includes `tier + model + speed` (`docs/directives/rates-history-ledger-phase4.md:56`-`58`), but "100 most-recent by `fit_at`" can become ambiguous if the cap falls across a group of same-`fit_at` fits (`docs/directives/rates-history-ledger-phase4.md:60`-`62`). This is unlikely at current scale, but the directive should specify a stable tie-breaker such as original ledger order, or `fit_at` descending plus `(tier, model, speed)` ascending, so client and tests cannot diverge.

2. **`--endpoint` is correctly identified as an operator override, but it is still a consent-token exfiltration path.**

   The directive says the trust boundary is `DEFAULT_SERVER`, with operator input only through the existing `--endpoint` override (`docs/directives/rates-history-ledger-phase4.md:27`, `docs/directives/rates-history-ledger-phase4.md:96`). The existing CLI does expose `--endpoint` (`bin/claude-meter.mjs:28`, `bin/claude-meter.mjs:81`) and `analyze --share` already sends the body token to `${endpoint}/api/v1/submit` (`src/cli/analyze.mjs:770`-`777`). That makes the override consistent with precedent, but for this load-bearing directive it should explicitly state the risk: any operator-supplied endpoint receives the bearer-like `consent_token` and `install_id`. If the project accepts that because `--endpoint` is an explicit operator flag, say so in the threat model.

3. **The 4xx "verbatim" error rule should exclude reflected secrets.**

   The directive requires surfacing the server's 4xx error body verbatim (`docs/directives/rates-history-ledger-phase4.md:64`-`70`). That is simple and matches the existing style, but this endpoint sends a consent token in the request body (`docs/directives/rates-history-ledger-phase4.md:84`-`96`). If the server accidentally echoes request content in an error response, the client could print the token. This is local terminal output, not a network leak, but the safer contract is "surface the server's `error` string verbatim, never echo request payload fields; if raw body contains `consent_token`, redact it." This can remain a small implementation rule.

4. **Persistent revoked-consent skip should probably be visible at least once.**

   The directive says persistent publishing silently skips after consent is revoked (`docs/directives/rates-history-ledger-phase4.md:52`-`54`). "Revoke wins" is correct, and avoiding recurring scheduled-refit noise is reasonable. The hidden failure mode is that an operator who set `weights_share_enabled` may believe they are still contributing after opt-out/re-consent transitions. A one-line notice on explicit `rates --share-weights` and maybe silence only for scheduled auto-publish would make the behavior clearer without spamming.

5. **Config test injection is under-specified against the current consent module.**

   The directive says tests will add a `--config-file` injection flag so consent state can be isolated (`docs/directives/rates-history-ledger-phase4.md:124`). Current `readConfig` and `writeConfig` are private functions hard-bound to `CONFIG_FILE` (`src/consent.mjs:53`-`65`, `src/constants.mjs:20`-`22`), so the implementation PR needs a concrete plan for how the flag reaches consent helpers without broadening production behavior. This is not a contract blocker, but it is the main testability seam.

### Nits

1. The repo-fact line "No endpoint-path constants exist" should be narrowed to "No community API path constants exist." `src/constants.mjs` does define `MESSAGES_ENDPOINT = "/v1/messages"` (`src/constants.mjs:29`), although the community paths `/api/v1/submit` and `/api/v1/register` are hard-coded at call sites (`src/cli/analyze.mjs:770`-`777`, `src/share/client.mjs:25`-`31`, `src/share/client.mjs:41`-`46`).

## Repo-State Verification

- `getConsentStatus()` returns `{ consented: true, token, timestamp, installId }` on valid consent and `{ consented: false, reason }` otherwise; it does not expose a `consent_token` property (`src/consent.mjs:102`-`119`).
- `requestConsent(skipInteractive = false)` is async and returns either the token string or `null` (`src/consent.mjs:128`-`179`).
- `readConfig()` / `writeConfig(config)` read and write `CONFIG_FILE`; `CONFIG_FILE` is `~/.claude/claude-meter-config.json` via `CLAUDE_DIR = ~/.claude` (`src/consent.mjs:53`-`65`, `src/constants.mjs:20`-`22`).
- `getInstallId()` creates and returns `config.install_hash` as `randomBytes(8).toString("hex")`, i.e. 16 hex characters (`src/consent.mjs:70`-`77`).
- `DEFAULT_SERVER` is `"https://meter.vsits.co"` (`src/constants.mjs:38`-`39`).
- `analyze --share` obtains a consent token through `requestConsent(args.yes)`, writes it to body field `consent_token`, and posts with only `Content-Type: application/json` to `${endpoint}/api/v1/submit` via `globalThis.fetch` (`src/cli/analyze.mjs:744`-`790`).
- The registered-key `share` subcommand is a distinct path: `shareCommand` calls `submitPayload` (`src/cli/share.mjs:43`-`49`), and `submitPayload` requires config `api_key` and sends it as `X-API-Key` to `${config.endpoint}/api/v1/submit` (`src/share/client.mjs:19`-`35`).
- The ledger fit shape is exactly the directive's listed aggregate object: `fit_at`, `tier`, `tier_started`, `model`, `speed`, `window_count`, `rows_total`, `r_squared`, `weights.{input,output,cache_read,cache_create}`, `validation.{method,predicted_pp,actual_pp,error_pct}`, and `cache_fix_label` (`src/cli/rates.mjs:304`-`326`). `appendFit` stores the object verbatim in `fits[]` (`src/cli/weights-ledger.mjs:31`-`40`). I did not find raw rows, session IDs, API keys, or log-file contents in that fit object.
- This PR ships one added file, the directive only (`git diff --name-status origin/main...HEAD` showed `A docs/directives/rates-history-ledger-phase4.md`). No implementation code is included.

## Contract Assessment

- Auth/consent gate: the consent-token body model is coherent and correctly follows the `analyze --share` precedent rather than the registered-key `share` path. The persistent stale-token risk is bounded by `getConsentStatus()` recomputing the token against current config before returning consent (`src/consent.mjs:102`-`119`), but server-side rejection remains possible and is covered by the 4xx path.
- Dedup key: `install_id + fit_at + tier + model + speed` is sufficient for current ledger semantics. `fit_at` has millisecond ISO precision (`src/cli/rates.mjs:296`), and same-refit entries intentionally share it but differ by model/speed (`src/cli/rates.mjs:299`-`326`).
- Max payload: 100 most-recent fits is defensible for v1, but silent exclusion of older never-sent fits is a known tradeoff when a ledger exceeds the cap. The directive's stderr notice is important (`docs/directives/rates-history-ledger-phase4.md:60`-`62`).
- Error handling: single-shot/no-retry is acceptable for v1 and keeps the client small. The directive correctly guarantees the local fit is appended before publish failure can matter (`docs/directives/rates-history-ledger-phase4.md:64`-`70`, `src/cli/rates.mjs:342`-`348`).
- Response shape: `{ accepted, rejected, errors[] }` is implementable (`docs/directives/rates-history-ledger-phase4.md:76`-`82`). Treating a 2xx unparseable response as generic success is acceptable only if transport success is the compatibility bar; it can mask a server regression, so tests should still assert the locked shape.

## NFR / Process

- Load-bearing classification is correct: this defines a cross-repo wire contract and transmits data off-machine (`docs/directives/rates-history-ledger-phase4.md:13`-`18`, `docs/directives/rates-history-ledger-phase4.md:34`).
- The Chris human-review requirement is stated for both directive and implementation PRs (`docs/directives/rates-history-ledger-phase4.md:17`-`18`, `docs/directives/rates-history-ledger-phase4.md:134`-`136`). This Codex verdict does not satisfy that requirement.
- The size budget is plausible for the described scope (`docs/directives/rates-history-ledger-phase4.md:20`-`32`, `docs/directives/rates-history-ledger-phase4.md:106`-`124`).
- Deferring implementation to a separate PR is explicit and confirmed by the PR diff (`docs/directives/rates-history-ledger-phase4.md:106`, `docs/directives/rates-history-ledger-phase4.md:134`-`136`).
- The out-of-scope cuts are right for v1: server implementation, pagination, retry/backoff, unpublish, and `X-API-Key` auth are all appropriately deferred or excluded (`docs/directives/rates-history-ledger-phase4.md:126`-`132`).

## Bottom Line

Request changes. The repo-state citations are materially correct for the consent API, config location, auth-model split, and ledger fit shape, and the selected consent-token body contract is the right auth model for this endpoint. But the directive must remove the full-history vs "just appended fits" contradiction before it can be a load-bearing implementation target.
