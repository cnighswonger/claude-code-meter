Verdict: REQUEST_CHANGES

# Review: rates history ledger master directive

Date: 2026-06-18
Reviewed: `docs/directives/rates-history-ledger.md` at `05e0532eb3919e11081a0c3ca1b4cb7369089b66`
Round: 1
Label applied: `changes-requested`

## Findings

### Blockers

1. The directive locks the wrong local storage root.

   The master directive repeatedly specifies the new ledger and drift-dismiss files under `~/.local/share/claude-meter/`: phase 1 threat model at `docs/directives/rates-history-ledger.md:44`, ledger path at `docs/directives/rates-history-ledger.md:69`, and drift-dismiss state at `docs/directives/rates-history-ledger.md:158`. It also says this is "under the existing meter data root from `src/constants.mjs`" at `docs/directives/rates-history-ledger.md:69`. The current repo does not define that root. `src/constants.mjs` defines `CLAUDE_DIR = join(homedir(), ".claude")` at `src/constants.mjs:20`, `LOG_FILE = join(CLAUDE_DIR, "claude-meter.jsonl")` at `src/constants.mjs:21`, `CONFIG_FILE = join(CLAUDE_DIR, "claude-meter-config.json")` at `src/constants.mjs:22`, and proxy ingestion paths under the same `CLAUDE_DIR` at `src/constants.mjs:29` and `src/constants.mjs:30`. The existing reader defaults to `LOG_FILE` from `src/constants.mjs`, not a `~/.local/share` path: `src/log/reader.mjs:1`, `src/log/reader.mjs:2`, `src/log/reader.mjs:8`.

   This is not a cosmetic mismatch. Phase 1 would create a new storage island outside the repo's existing data root while claiming it matches the canonical root, Phase 2 would put `last-drift-seen.txt` beside that non-canonical ledger, and Phase 4's persistent consent plan points at a third path. The directive needs to either change the contract to the current `~/.claude` root or first add an explicit migration/root decision as part of the directive.

2. Phase 4's persistent consent contract references a non-existent file and does not match the current consent/auth shape.

   The directive says persistent weight sharing will probably extend `~/.local/share/claude-meter/consent.json` at `docs/directives/rates-history-ledger.md:235`, and later requires `src/consent.mjs` to extend the consent record with `weights_share_enabled` at `docs/directives/rates-history-ledger.md:242`. The current consent module reads and writes `CONFIG_FILE`, not `consent.json`: `src/consent.mjs:16`, `src/consent.mjs:53`, `src/consent.mjs:55`, `src/consent.mjs:63`, `src/consent.mjs:64`. That `CONFIG_FILE` is `~/.claude/claude-meter-config.json`: `src/constants.mjs:20`, `src/constants.mjs:22`.

   The existing consent return shape is also narrower than the directive assumes: `getConsentStatus()` returns `{ consented, token, timestamp, installId }` only when the token validates at `src/consent.mjs:102`, `src/consent.mjs:107`, `src/consent.mjs:110`, `src/consent.mjs:115`. Existing share submission also uses API key and endpoint from `CONFIG_FILE`, posting to `/api/v1/submit`: `src/share/client.mjs:1`, `src/share/client.mjs:2`, `src/share/client.mjs:19`, `src/share/client.mjs:25`, `src/share/client.mjs:29`. The current analyze-share path explicitly adds `consent_token` before posting: `src/cli/analyze.mjs:744`, `src/cli/analyze.mjs:746`, `src/cli/analyze.mjs:759`, `src/cli/analyze.mjs:773`. Phase 4 needs to name the actual persistence file and fields, and state whether `/api/v1/weights` carries the consent token, API key, both, or a different gate.

3. Phase 1 depends on an "existing `--tier` flag" that is not present in the current CLI contract.

   The directive says `rates --refit` uses the operator's already-supplied `--tier-start-date` and the existing `--tier` flag at `docs/directives/rates-history-ledger.md:108`, and the ledger requires `tier` at `docs/directives/rates-history-ledger.md:79`. The CLI parser currently declares `plan`, not `tier`, at `bin/claude-meter.mjs:22`, includes `plan` in the generic args object at `bin/claude-meter.mjs:100`, and the `rates` dispatch forwards only `logFile`, `by`, and `tier-start-date` beyond the generic args at `bin/claude-meter.mjs:134`, `bin/claude-meter.mjs:139`. The rates implementation itself consumes `args["tier-start-date"]` for window mode at `src/cli/rates.mjs:21`, `src/cli/rates.mjs:33`, and does not currently establish a tier identity.

   Because `tier` is part of the ledger key and drift comparison scope, two implementers could reasonably diverge: one might add a new `--tier`, one might reuse `--plan`, and one might infer from `--tier-start-date` or existing rows. The directive must lock the CLI flag name, accepted values, default/unknown behavior, and how the `tier` ledger field is populated.

### Attention Items

1. Phase 3 changes default `rates` behavior more than the load-bearing discussion admits.

   The directive classifies phases 1-3 as not load-bearing because they are CLI/local-disk surfaces at `docs/directives/rates-history-ledger.md:58` and `docs/directives/rates-history-ledger.md:59`. Phase 3 then says the scheduled-refit gate fires when the operator runs any `rates` command at `docs/directives/rates-history-ledger.md:180`, auto-refits before continuing when the most recent fit is >= 28 days old at `docs/directives/rates-history-ledger.md:187`, and checks the gate at the top of `ratesCommand` at `docs/directives/rates-history-ledger.md:198`. Today `ratesCommand` is read-only in the normal path: it reads rows at `src/cli/rates.mjs:21`, `src/cli/rates.mjs:22`, then prints row or window output at `src/cli/rates.mjs:28`, `src/cli/rates.mjs:33`. Phase 3 would make a normal `rates` invocation mutate the ledger and possibly publish in Phase 4 when persistent sharing is enabled at `docs/directives/rates-history-ledger.md:255`.

   I agree this is not a wire/schema load-bearing change before Phase 4, but it is an operator-visible behavioral change. The directive should require an explicit output line when an automatic refit runs, and should define whether `rates --history`, `rates --dismiss-drift`, and `rates --refit` themselves are included in "ANY `rates` command" or excluded from the scheduled gate.

2. The Phase 2 drift-dismiss state is close but does not fully specify how "next drift event" is distinguished from a newer non-drift fit.

   The directive stores only the dismissed `fit_at` timestamp in `last-drift-seen.txt` at `docs/directives/rates-history-ledger.md:158`, and test 6 says `--dismiss-drift` suppresses the banner until the next drift event at `docs/directives/rates-history-ledger.md:175`. The implementation surface says default `rates` reads the most recent fit and compares `fit_at` to that dotfile at `docs/directives/rates-history-ledger.md:163`. It should explicitly say whether default `rates` recomputes drift from the most recent fit and its prior same `(tier, model, speed)` fit, or whether the ledger must persist a drift-event marker. With timestamp-only state, a later non-drift refit can be newer than the dismissed timestamp unless the banner path also recomputes `computeDrift`.

3. `schema_version: 1` is useful only if reader behavior is specified.

   The ledger shape includes `schema_version: 1` at `docs/directives/rates-history-ledger.md:73` and `docs/directives/rates-history-ledger.md:75`, but the phase 1 tests only require missing-file, existing-file, append, filter, and CLI behavior at `docs/directives/rates-history-ledger.md:122` through `docs/directives/rates-history-ledger.md:130`. Without a test for absent, unsupported, or future `schema_version`, this is decoration rather than a forward-compat hedge. Add reader behavior: accept missing as v1 for migration or reject it; reject future versions with a clear error; preserve top-level fields on append or rewrite only the v1 object.

4. Phase 4's wire contract is intentionally skeletal, but the master directive should name the minimum contract that Phase 4 must lock.

   The directive says the exact field semantics will be locked in the phase-4 directive at `docs/directives/rates-history-ledger.md:216`, `docs/directives/rates-history-ledger.md:218`, and gives only a skeleton with `schema_version`, `install_id`, `submitted_at`, and `fits` at `docs/directives/rates-history-ledger.md:220` through `docs/directives/rates-history-ledger.md:226`. That deferral is acceptable for server details, but the master should still require Phase 4 to lock consent/auth fields, idempotency/dedup keys, max payload size, server error handling, and whether `fits` is full-history or only newly appended fits. The tests currently say only that a mock server confirms request shape at `docs/directives/rates-history-ledger.md:252`, `docs/directives/rates-history-ledger.md:253`.

5. The new `src/cli/weights-share.mjs` module may be justified, but the directive should set the decision rule.

   The master maintainability section allows one method in `src/cli/share.mjs` or a sibling `src/cli/weights-share.mjs` if the share module gets too crowded at `docs/directives/rates-history-ledger.md:54`, while the Phase 4 implementation surface directly names a new `src/cli/weights-share.mjs` at `docs/directives/rates-history-ledger.md:240`. The current `src/cli/share.mjs` is only 53 lines and delegates actual HTTP submission to `src/share/client.mjs`: `src/cli/share.mjs:1`, `src/cli/share.mjs:2`, `src/cli/share.mjs:7`, `src/cli/share.mjs:44`. A new module is probably fine for a distinct endpoint client, but the directive should align the maintainability section and Phase 4 surface so implementation review has a clear anti-bloat standard.

### Nits

1. The ledger field names mix output vocabulary and storage vocabulary without an explicit mapping.

   The windowing output prints "Cache Write" for `cache_creation_input_tokens` at `src/cli/rates.mjs:186`, `src/cli/rates.mjs:203`, `src/cli/rates.mjs:204`, while the ledger shape stores `cache_create` at `docs/directives/rates-history-ledger.md:89` and `docs/directives/rates-history-ledger.md:90`. That is reasonable, but the directive should explicitly map storage keys to row fields and display labels.

2. The ledger append-only claim is defensible if the path is corrected.

   The file-size assumption is reasonable: the directive bounds expected entries to dozens per year at `docs/directives/rates-history-ledger.md:56`, always appends in v1 at `docs/directives/rates-history-ledger.md:104`, and explicitly defers de-duplication at `docs/directives/rates-history-ledger.md:274`, `docs/directives/rates-history-ledger.md:275`. Once the canonical path is fixed, append-only is simpler and safer than in-place mutation for this size.

## What Is Correct

- The four-phase split is directionally sound. Phase 1 provides a manual local ledger and history view at `docs/directives/rates-history-ledger.md:64` through `docs/directives/rates-history-ledger.md:65`; Phase 2 adds drift warning without cadence at `docs/directives/rates-history-ledger.md:134` through `docs/directives/rates-history-ledger.md:135`; Phase 3 adds cadence at `docs/directives/rates-history-ledger.md:179` through `docs/directives/rates-history-ledger.md:180`; Phase 4 is the first wire-contract phase at `docs/directives/rates-history-ledger.md:213` through `docs/directives/rates-history-ledger.md:216`.
- The master process matches the repo's branch-shape constraint. The directive uses hyphenated phase branches at `docs/directives/rates-history-ledger.md:5`, and the process section repeats that nested refs are avoided via `feature/rates-history-ledger-phase{1..4}` at `docs/directives/rates-history-ledger.md:283`.
- The fields `rows_total`, `window_count`, `r_squared`, validation, and `cache_fix_label` are computable from the post-windowing surface. `groupByQuotaWindow()` returns window rows and `q5h_max` at `src/log/reader.mjs:71` through `src/log/reader.mjs:82`; window-mode computes qualifying windows and total rows at `src/cli/rates.mjs:85` through `src/cli/rates.mjs:89`, `src/cli/rates.mjs:120` through `src/cli/rates.mjs:124`; it computes R-squared and held-out validation at `src/cli/rates.mjs:160` through `src/cli/rates.mjs:183`; and cache-fix labeling is derived from `agent_id` / `request_id` at `src/cli/rates.mjs:241` through `src/cli/rates.mjs:253`, matching schema keys at `src/log/schema.mjs:105` through `src/log/schema.mjs:119`.
- The acceptance-test posture is good on the CLI boundary. Phase 1 requires subprocess tests against `claude-meter rates --refit` and `claude-meter rates --history` at `docs/directives/rates-history-ledger.md:129` and `docs/directives/rates-history-ledger.md:130`, which preserves the parser/dispatch discipline established in the prior windowing directive at `docs/directives/rates-windowing.md:150` through `docs/directives/rates-windowing.md:159`.

## Recommendations

1. Amend the directive before implementation to choose one canonical data root and name a constant for the ledger/dismiss files. If the desired product direction is `~/.local/share/claude-meter`, this directive needs to include migration or compatibility language from the current `~/.claude` paths in `src/constants.mjs:20` through `src/constants.mjs:30`.
2. Replace "existing `--tier` flag" with an explicit parser contract. Either reuse `--plan` from `bin/claude-meter.mjs:22` or add `--tier`; do not leave this to phase implementers.
3. For Phase 4, require the phase-specific directive to lock auth/consent fields, storage file, and full request/response schema before code starts. The master should not pretend `consent.json` exists.
4. Add tests for future/invalid ledger schema versions and the drift-dismiss cycle where a dismissed drift is followed by a non-drift fit and then a new drift.

## Bottom Line

Revise before implementation. The broad product shape is good, and the phase split is workable, but the contract currently points at storage and consent surfaces that do not exist in this repo and leaves tier identity undefined even though tier is part of the ledger and drift keys. Those are directive-level blockers because compliant implementations could land incompatible local files, consent state, and CLI flags.
