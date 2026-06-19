# Directive: rates weight-history ledger + drift detection + scheduled refit + public share (master)

**Issues:** [#34](https://github.com/cnighswonger/claude-code-meter/issues/34)
**Parent branch:** `feature/rates-history-ledger` (master)
**Sub-branches (one per phase):** `feature/rates-history-ledger-phase{1,2,3,4}` — each merges back into the parent via its own PR; the parent merges to `main` once all four phases land.
**Stage:** directive — round 2.1 (Codex r1 + r2 REQUEST_CHANGES folded; awaiting r3 freshness verification)
**Milestone:** v0.8.2 (phase 1 + 2 + 3) and v0.9.0 (phase 4, contemporaneous with the `--by row` removal)

## Revision history

- **r1 → r2** (this amendment): folded Codex r1 REQUEST_CHANGES findings.
  - **Blocker 1 — wrong storage root.** Directive said `~/.local/share/claude-meter/` but `src/constants.mjs:20` defines `CLAUDE_DIR = ~/.claude` as the canonical root. Switched ledger to `~/.claude/claude-meter-history.json` (next to the existing `claude-meter-config.json` and `claude-meter.jsonl`); switched drift-dismiss state to `~/.claude/claude-meter-drift-seen` for the same reason. No migration needed — no pre-existing files at the wrong path.
  - **Blocker 2 — phase 4 referenced non-existent `consent.json`.** Replaced with the actual `CONFIG_FILE` (`~/.claude/claude-meter-config.json`) that `src/consent.mjs` reads via `readConfig`/`writeConfig`. Phase 4 extends the config record with `weights_share_enabled: boolean`. Auth reuses the existing `consent_token` wire payload field already POSTed by `src/cli/analyze.mjs:744`-`:773`; the token string source is `requestConsent()` (one-shot) or `getConsentStatus().token` (persistent). `getConsentStatus()` returns `{consented, token, timestamp, installId}` (not a `consent_token` property) — the wire field name differs from the API return shape. No new auth surface.
  - **Blocker 3 — non-existent `--tier` flag.** Replaced with the existing `--plan` flag (`bin/claude-meter.mjs:22`, accepts `pro`/`max-5x`/`max-20x`/`api`/`unknown`). The ledger's `tier` field is populated from `args.plan` (or `"unknown"` if absent). `--plan` is required for `--refit` and any scheduled refit.
  - **AI #1 — phase 3 behavioral change.** Added explicit "Auto-refit ran" output line. Defined which `rates` invocations are subject to the cadence gate (only the default window-mode path; `--history`, `--dismiss-drift`, `--refit`, `--skip-scheduled-refit` are excluded).
  - **AI #2 — drift-dismiss state semantics.** Clarified that the default `rates` path always recomputes drift from the ledger (most-recent fit vs prior same-`(tier, model, speed)` fit) on every invocation; `last-drift-seen` only suppresses the banner if its timestamp matches the most-recent drifted fit's `fit_at`. A subsequent non-drift fit means no banner regardless of the dotfile.
  - **AI #3 — `schema_version` reader behavior.** Added explicit reader semantics: missing `schema_version` treated as `1`; values > 1 cause `readLedger` to throw a clear error; phase 1 tests gain a case for both.
  - **AI #4 — phase 4 minimum wire-contract lock.** Master directive now lists the minimum the phase-4 directive PR must lock: consent/auth fields, dedup/idempotency key, max payload size, server error handling, and whether `fits` is full-history or delta-only.
  - **AI #5 — new module rule.** Aligned the maintainability section with the phase-4 surface: a new `src/cli/weights-share.mjs` is the chosen path; rationale is that `src/cli/share.mjs` posts to `/api/v1/submit` (analyze rows) while weights are a distinct endpoint and payload shape. Inlining would entangle two endpoints in one module.
  - **Nit #1 — display vs storage vocabulary.** Added an explicit mapping table: storage key `cache_create` ↔ row field `cache_creation_input_tokens` ↔ display label `Cache Write`.
- **r2 → r2.1** (this in-place edit): folded Codex r2 partial-resolution items.
  - **B1 residual.** Phase 2's implementation surface still referenced `last-drift-seen.txt` instead of the locked `DRIFT_SEEN_FILE` constant. Replaced. Also added a cross-reference from the Phase 2 surface to the Phase 2 banner-decision algorithm + a note that Phase 3's cadence path reuses the same algorithm (closes the Phase 2→Phase 3 dependency Codex flagged as implicit).
  - **B2 mischaracterization.** The r2 revision-history block said `getConsentStatus()` returns a `consent_token` property; the actual return is `{consented, token, timestamp, installId}`. The wire payload field IS `consent_token` (per `src/cli/analyze.mjs:744`-`:773`) but it's sourced from `requestConsent()` (one-shot) or `getConsentStatus().token` (persistent). Updated Phase 4's wire-contract description and the revision-history block to distinguish API return shape vs wire field name.
  - **B3 residual.** Ledger example and test 6 used `max-2x` as a `--plan` value; `bin/claude-meter.mjs:65` lists `pro`/`max-5x`/`max-20x`/`api`/`unknown` as the documented accepted values. Replaced both occurrences with `max-20x`.
  - **AI #1 cleanup.** Phase 3 goal said the gate fires on "ANY `rates` command", contradicting the new §"Gate scope" exclusion list. Tightened to "only on the default-mode `rates` invocation (see §Gate scope for the exclusion list)".

## Goal

Build a longitudinal record of Anthropic's empirical Q5h weighting on top of the window-mode regression that landed in #33. Per-fit recovered weights are themselves a substrate that drifts over time as Anthropic re-tunes the unified rate-limit formula; the meter is currently the only mechanism that can recover those weights empirically, so it should also be the mechanism that tracks them.

This directive locks the contract for all four phases AITL named in [#34](https://github.com/cnighswonger/claude-code-meter/issues/34):

1. **Phase 1** — append-only weight-history ledger + manual `rates --refit` command.
2. **Phase 2** — drift detection on refit, warning surfaced at next `rates` invocation.
3. **Phase 3** — scheduled monthly refit anchored to plan-renewal date.
4. **Phase 4** — public-share endpoint for opted-in weight history (load-bearing — new wire contract).

Each phase ships as its own sub-PR with its own Codex review; the master directive locks the contract for all four so phase 1 reviewers can see where phases 2-4 are going. Amendment-on-branch if a contract point drifts during implementation.

## Why

Three reasons in increasing weight (per AITL's framing on #34):

1. **Currency.** Anthropic adjusts the unified rate-limit formula silently. Empirical weights derived once and frozen go stale. A monthly refit + history ledger keeps the recovered weights current without manual intervention.

2. **Operator-side detection.** If Anthropic re-weights `cache_create` from 381× to 500× `cache_read` (hypothetical), every Max user instantly burns Q5h faster, but nobody sees it as a re-weighting — they just see "Q5h is moving faster this month." Drift detection on the weights surfaces the actual cause.

3. **Substrate for community measurement.** Aggregate weight history across opted-in meter users is a continuously-updated open record of Anthropic's quota weighting. The meter's existing `share`/`dataset` pipeline is the natural home for it.

Per-row regression (#33's pre-state) didn't recover usable weights, so per-row history tracked nothing meaningful. Window-mode regression unblocks all four phases of this directive.

## Non-Functional Requirements

- **Size/complexity budget (master):**
  - Phase 1: ~80 LOC implementation (ledger read/write + `--refit` dispatch) + ~80 LOC tests.
  - Phase 2: ~50 LOC implementation (diff computation + drift-warning print path) + ~60 LOC tests.
  - Phase 3: ~60 LOC implementation (cadence calculation + scheduled-refit gate) + ~60 LOC tests.
  - Phase 4: ~80 LOC implementation (share endpoint client + opt-in gating) + ~80 LOC tests, plus server-side endpoint work tracked separately if the meter API server is in scope at that time.
  - Master total: ~270 LOC impl + ~280 LOC tests. Reviewers should flag if any single phase drifts materially past 2× its phase budget.

- **Threat model:**
  - **Phase 1.** New on-disk surface at `~/.claude/claude-meter-history.json` (under the existing `CLAUDE_DIR` root defined at `src/constants.mjs:20`, alongside `claude-meter-config.json` and `claude-meter.jsonl`). Append-only JSON file. No credentials, no API keys, no PII. Same threat profile as the existing `claude-meter.jsonl`. Mode `0644` matches the existing meter data files; the file contains only aggregated tier-level fit summaries with no per-call data.
  - **Phase 2.** No new on-disk surface beyond phase 1; drift detection is a pure comparison between consecutive ledger entries.
  - **Phase 3.** No new on-disk surface; cadence state is derived from the ledger's most-recent `fit_at` timestamp.
  - **Phase 4.** New wire-format contract — `POST /api/v1/weights` schema. Reuses the existing `share` consent gate (operators who haven't run `claude-meter consent` cannot submit). No new credentials; reuses the existing meter API endpoint auth. The phase-4 directive PR will spell out the exact wire contract and any operator-attestation language required.

- **Maintainability constraints:**
  - **No new abstractions** beyond what the contract requires. The ledger is one new module (`src/cli/weights-ledger.mjs`) with read/write/append/diff helpers. No new "service layer" or framework.
  - The drift-warning print path piggybacks on the existing `rates` output path; no new "warning subsystem."
  - The scheduled-refit gate reads ledger state directly; no new "scheduler" or "cron-like" subsystem.
  - Phases 1–3 stay confined to `src/cli/rates.mjs`, `src/cli/weights-ledger.mjs` (new), `bin/claude-meter.mjs`, `src/constants.mjs` (two new path constants), and their tests. No changes to schema, share, or server modules.
  - Phase 4 adds `src/cli/weights-share.mjs` (new) — separate from `src/cli/share.mjs` because the existing share module posts to `/api/v1/submit` (analyze rows) and the weights endpoint is `/api/v1/weights` with a distinct payload shape. Inlining would entangle two endpoints' wire contracts in one module. Phase 4 also extends `src/consent.mjs` with helpers to read/write the new `weights_share_enabled` config field.

- **Performance/reliability:** the ledger is bounded by one fit per `(tier, model)` per refit cadence — order of dozens of entries per year per operator. JSON read/write is O(file size), which stays under 100KB indefinitely. No perf concerns.

- **Load-bearing?**
  - **Phases 1–3: No.** All CLI-output and local-disk surfaces. No schema, no wire contract, no credentials. The ledger file is internal to the meter installation; operators who don't use `rates` never touch it.
  - **Phase 4: Yes.** New wire-format contract (`POST /api/v1/weights`) with cross-repo implications (the meter API server in `cnighswonger/claude-code-meter-api` will need to accept this schema). Per `CLAUDE.md`, load-bearing changes require human (Chris) review before merge in addition to Lead + Codex. Phase 4 directive PR will lock the wire schema; the server-side endpoint implementation tracks separately under the meter-api repo.

## Phase 1 — ledger + `rates --refit`

### Goal
Land the durable storage substrate. After phase 1, an operator who runs `claude-meter rates --refit` has a fit recorded in a local ledger; running `rates --history` prints the ledger contents.

### Ledger file format

Path: `~/.claude/claude-meter-history.json` (under the existing `CLAUDE_DIR` from `src/constants.mjs:20`, next to `claude-meter-config.json` and `claude-meter.jsonl`). Add as `HISTORY_FILE` export in `src/constants.mjs`.

### Storage / display / row-field key mapping

The ledger uses storage keys distinct from the existing display labels and JSONL row fields, so reviewers and downstream tools see one explicit table:

| Storage key (ledger) | JSONL row field (`src/log/schema.mjs`) | Display label (`src/cli/rates.mjs`) |
|---|---|---|
| `input` | `input_tokens` | `Input` |
| `output` | `output_tokens` | `Output` |
| `cache_read` | `cache_read_input_tokens` | `Cache Read` |
| `cache_create` | `cache_creation_input_tokens` | `Cache Write` |

Storage keys are the SI-style short form to keep the ledger compact and stable across CLI-display refactors.

Shape (one operator, multiple fits over time):

```json
{
  "schema_version": 1,
  "fits": [
    {
      "fit_at": "2026-06-17T17:00:00Z",
      "tier": "max-20x",
      "tier_started": "2026-05-23",
      "model": "claude-opus-4-7",
      "speed": "standard",
      "window_count": 88,
      "rows_total": 3530,
      "r_squared": 0.7148,
      "weights": {
        "input":        8.3862,
        "output":       60.8049,
        "cache_read":   0.0262,
        "cache_create": 10.0061
      },
      "validation": {
        "method": "hold-out-most-recent",
        "predicted_pp": 58.3,
        "actual_pp": 57.0,
        "error_pct": 2.3
      },
      "cache_fix_label": "cache_fix_mixed"
    }
  ]
}
```

The `fits` array is append-only — never edit or delete existing entries. New fits append at the end. Per-`(tier, model, speed)` history is reconstructed by scanning the array and filtering.

### CLI surface (phase 1)

- **`claude-meter rates --refit`** — runs window-mode regression on the current log (using the operator's already-supplied `--tier-start-date` and the existing `--plan` flag at `bin/claude-meter.mjs:22`), then appends the result to the ledger. Prints the fit summary to stdout. Idempotent in the trivial sense: re-running immediately produces a near-identical fit and appends another entry (no de-duplication in v1 — operators who want to keep the ledger lean either don't re-run unnecessarily or use phase 3's scheduled cadence).

- **`claude-meter rates --history`** — prints all entries from the ledger, most-recent first, formatted as a table. Filter flags `--model <name>` and `--plan <tier>` narrow the output but do not modify the ledger.

- **`--tier-start-date`** remains required for `--refit` (same contract as window-mode `rates`). `--plan` is also required for `--refit` so the ledger's `tier` field is populated; missing `--plan` produces a clear error. The phase-1 directive does not change the default-mode `rates` contract — only adds `--refit` and `--history` as additional dispatch paths.

### Tier identity in the ledger

The ledger's `tier` field is populated from the `--plan` value the operator supplied to that `--refit` invocation. Accepted values match the existing `--plan` flag's documentation in `bin/claude-meter.mjs:65`: `pro`, `max-5x`, `max-20x`, `api`, `unknown`. Any other value triggers the same parser-time error path that any other `--plan` consumer already produces today. No new tier-inference logic in v1.

### Implementation surface (phase 1)

- **`src/cli/weights-ledger.mjs`** (NEW) — ~50 LOC. Exports `readLedger(path)`, `appendFit(path, fit)`, `filterFits(fits, {tier?, model?, speed?})`. Pure functions over the JSON shape; no console output. Mirrors the file-handling pattern from `src/log/reader.mjs`.
- **`src/cli/rates.mjs`** — add `runRefit(args)` and `runHistory(args)` functions; dispatch on `args.refit` and `args.history` BEFORE the existing window-mode/row-mode dispatch.
- **`bin/claude-meter.mjs`** — add `refit` and `history` to the `parseArgs` options (as booleans), forward them via `args` to `ratesCommand`.

### Tests (phase 1)

`test/rates-history-ledger-phase1.test.mjs` — 7 tests:

1. `readLedger` returns empty `{ fits: [] }` when the file doesn't exist.
2. `readLedger` returns the existing file's contents on a populated ledger.
3. `appendFit` adds an entry to a fresh ledger and persists it.
4. `appendFit` preserves existing entries when adding to a populated ledger.
5. `filterFits` returns only matching entries on multi-tier history.
6. Subprocess CLI: `claude-meter rates --refit --tier-start-date 2026-05-23 --plan max-20x --log-file <synthetic JSONL>` appends one entry to the ledger and prints the fit summary on stdout.
6b. Subprocess CLI: `claude-meter rates --refit --tier-start-date 2026-05-23 --log-file <synthetic JSONL>` (no `--plan`) exits non-zero with a clear "—plan required for --refit" error.
6c. `readLedger` accepts a file with missing `schema_version` (treated as 1) and rejects `schema_version: 999` with a clear error naming the unsupported version.
7. Subprocess CLI: `claude-meter rates --history` prints all entries in reverse-chronological order.

## Phase 2 — drift detection

### Goal
After every successful refit, compare new weights to the most-recent prior fit (same `tier`+`model`+`speed`). If any weight has shifted by more than 15% (default threshold), print a drift warning at the bottom of the `--refit` output AND at the top of the next `rates` invocation until the operator dismisses it.

### Drift threshold
Hard-coded 15% for v1 (per AITL's design sketch on #34). Configurable in a follow-up if real-world signal proves it noisy.

### Drift output format

```
DRIFT DETECTED — Q5h weights have changed since last fit (2026-05-17):

  cache_read:    0.0260 → 0.0262   (+0.8%)
  cache_create:  10.01  → 13.20    (+31.9%)  ⚠
  input:         8.39   → 8.21     (-2.1%)
  output:        60.80  → 58.40    (-3.9%)

Workloads that were quota-efficient last month may now burn faster.
Run `claude-meter rates --history` to see the full weight trajectory.
```

The `⚠` marker appears only on weights that crossed the threshold. The summary sentence ("Workloads that were quota-efficient...") fires when any weight crossed; it's hard-coded — no LLM-generated explanation.

### Dismiss-warning surface

A small dotfile `~/.claude/claude-meter-drift-seen` containing the `fit_at` ISO timestamp of the drift event the operator has already dismissed. Add as `DRIFT_SEEN_FILE` export in `src/constants.mjs`.

**Banner-decision algorithm** (run at the top of every default-mode `rates` invocation, after the optional phase-3 cadence trigger):

1. Read the ledger. If empty, no banner.
2. Take the most-recent fit. Find the prior fit with the same `(tier, model, speed)`. If no prior, no banner (first fit can't drift).
3. Call `computeDrift(prior, current)`. If `drifted === false`, no banner.
4. Read `DRIFT_SEEN_FILE`. If its content equals `current.fit_at`, the operator already dismissed THIS drift event — no banner. Otherwise, print the banner.

This algorithm makes the dotfile a per-fit dismiss marker. A subsequent non-drift refit (drift === false) means no banner regardless of the dotfile, because step 3 short-circuits before step 4. A subsequent drift refit with a different `fit_at` produces a fresh banner. `claude-meter rates --dismiss-drift` writes the current most-recent fit's `fit_at` to the dotfile.

### Implementation surface (phase 2)

- **`src/cli/weights-ledger.mjs`** — add `computeDrift(prevFit, currentFit, thresholdPct=15)` returning `{drifted: bool, items: [{weight, prev, current, change_pct, crossed_threshold}]}`.
- **`src/cli/rates.mjs`** — `runRefit` calls `computeDrift` against the prior matching fit; if `drifted`, prints the banner. `runWindowMode` (the default `rates` invocation) reads the most-recent fit, checks `DRIFT_SEEN_FILE`, and prints the banner at the top of its output if the operator hasn't dismissed it. The Phase 3 cadence path (when scheduled-refit fires) reuses this same banner-decision algorithm — see §"Banner-decision algorithm" above.
- **`bin/claude-meter.mjs`** — add `--dismiss-drift` boolean.

### Tests (phase 2)

`test/rates-history-ledger-phase2.test.mjs` — 6 tests:

1. `computeDrift` returns `drifted: false` when all weights are within threshold.
2. `computeDrift` returns `drifted: true` and flags the specific weight that crossed.
3. `computeDrift` handles missing prior fit (returns `drifted: false` — first fit can't drift from anything).
4. Subprocess: `--refit` after a drift-inducing change prints the drift banner.
5. Subprocess: subsequent `rates` invocation prints the drift banner above the regression output.
6. Subprocess: `--dismiss-drift` suppresses the banner until the next drift event.

## Phase 3 — scheduled refit

### Goal
Add monthly cadence so operators don't have to remember to run `--refit`. The scheduled-refit gate fires only on the default-mode `rates` invocation (see §"Gate scope" below for the explicit exclusion list) when the time since the most-recent fit exceeds the cadence window.

### Cadence

Default: monthly (28 days). Per AITL's design: "anchored to the user's plan-renewal date" (the operator's `--tier-start-date` value, modulo months). The simpler v1 implementation:

- Cadence window = 28 days.
- If `now - most_recent_fit.fit_at >= 28 days` AND a `--tier-start-date` is set AND a `--plan` is set: auto-refit on next default-mode `rates` invocation, print the new fit + any drift warning, then continue with the requested output. The auto-refit is announced with a line printed BEFORE the regression output:
  > `Scheduled refit ran (last fit was N days ago). Re-fitting and continuing.`
- Tier transitions (new `--tier-start-date` value vs the ledger's most-recent `tier_started`, or new `--plan` value vs the ledger's most-recent `tier`) reset the cadence — fit immediately on next default-mode `rates` invocation, suppress drift detection (no prior fit in this `(tier, model, speed)` keyspace). Announce with:
  > `Tier transition detected (was: <old>, now: <new>). Starting a new fit history.`

### Gate scope (which `rates` invocations trigger the cadence)

The cadence gate fires ONLY for the default-mode `rates` invocation (the window-mode regression). It does NOT fire for:

- `claude-meter rates --refit` — already an explicit refit; redundant to gate.
- `claude-meter rates --history` — read-only ledger inspection.
- `claude-meter rates --dismiss-drift` — dotfile-only operation.
- `claude-meter rates --by row` — legacy path; behavioral parity with pre-#34.
- Any invocation with `--skip-scheduled-refit` — explicit one-shot opt-out.

This keeps the operator-visible behavior change scoped to the default-mode `rates` invocation only. Operators who only ever use `rates --history` never see a refit they didn't ask for.

The "anchored to plan-renewal date" piece is deferred to a follow-up — v1 uses a rolling 28-day window. Cadence-anchoring requires inferring the operator's specific renewal day-of-month, which AITL flagged as the same magic class as q7d-reset inference in the #33 directive.

### Suppression

`claude-meter rates --skip-scheduled-refit` for the current invocation (one-shot). No persistent disable in v1 — operators who want to opt out can use `--by row` (still deprecated but functional through v0.9.0) or simply not run `rates`.

### Implementation surface (phase 3)

- **`src/cli/rates.mjs`** — at the top of `ratesCommand`, check ledger age. If cadence-due and not explicitly skipped, run `runRefit` first, then continue with the requested output.
- **`bin/claude-meter.mjs`** — add `--skip-scheduled-refit` boolean.

### Tests (phase 3)

`test/rates-history-ledger-phase3.test.mjs` — 5 tests:

1. Ledger is empty → cadence triggers immediately on first `rates` invocation with a tier-start-date.
2. Most-recent fit is < 28 days old → cadence does NOT trigger.
3. Most-recent fit is >= 28 days old → cadence triggers; ledger gains a new entry; subsequent `rates` output reflects the new weights.
4. Tier transition (new `--tier-start-date` OR `--plan` vs ledger's most-recent values) → cadence triggers immediately, drift detection suppressed, "Tier transition detected" announcement printed.
5. `--skip-scheduled-refit` suppresses the cadence trigger for that invocation.

## Phase 4 — public-share endpoint (load-bearing)

### Goal
Allow operators who have already run `claude-meter consent` to opt into publishing their weight-history ledger to the community dataset. The endpoint is at `POST /api/v1/weights` on the meter API server.

### Wire contract (skeleton — phase 4 directive PR locks exact semantics)

```json
{
  "schema_version": 1,
  "install_id": "<existing meter install_id from CONFIG_FILE>",
  "consent_token": "<existing token from CONFIG_FILE>",
  "submitted_at": "<RFC3339 UTC>",
  "fits": [ <ledger fit object verbatim> ]
}
```

Reuses the existing `install_id`-keyed dedup and the `consent_token` wire field that `src/cli/analyze.mjs` already passes when posting to `/api/v1/submit` (see `src/cli/analyze.mjs:744`-`:773`). The token string itself comes from either `requestConsent(args.yes)` (the one-shot share path used by analyze today) or `getConsentStatus().token` (the persistent-share path used when `weights_share_enabled: true` is already set in `CONFIG_FILE`). The wire payload field is named `consent_token` in both cases. No new auth surface.

### Minimum wire-contract lock list for the phase-4 directive

The phase-4 directive PR MUST lock at least these contract points before any code lands:

1. **Auth/consent fields** — confirm `consent_token` is the gate (matching the existing `/api/v1/submit` path), or specify a separate gate. If a separate gate, name the field and the persistence file.
2. **Idempotency / dedup key** — `install_id` alone, `install_id + fit_at`, or `install_id + fits[].fit_at + fits[].tier + fits[].model + fits[].speed`. Determines whether duplicate submissions overwrite, merge, or are rejected.
3. **Max payload size** — operators with a year of monthly fits across two models/tiers could have ~24-48 entries. Lock the hard cap (proposed: 100 entries per request; clients paginate beyond that).
4. **Server error handling** — what HTTP status codes the client treats as retryable vs terminal. What error body shape the client surfaces to the operator.
5. **Submission scope** — `fits` is full ledger (server dedupes) OR only fits not yet submitted (client tracks `last_submitted_at` in CONFIG_FILE). Pick one; v1 leans toward full-history-server-dedupes for simpler client state.
6. **Server response shape** — what the client expects on 2xx (e.g. `{accepted: N, rejected: M, errors: [...]}`).

### Opt-in semantics

- Default: weights are NOT published.
- `claude-meter rates --share-weights` opts in for the current invocation (one-shot publish).
- `claude-meter rates --share-weights --persistent` opts in for all future scheduled refits. Persistence: a new boolean field `weights_share_enabled` in `CONFIG_FILE` (`~/.claude/claude-meter-config.json`), read and written by `src/consent.mjs`'s existing `readConfig`/`writeConfig`.
- Existing `claude-meter consent` is a prerequisite — operators who haven't consented to the share program cannot publish weights either.

### Implementation surface (phase 4)

- **`src/cli/weights-share.mjs`** (NEW) — POST client. ~40 LOC.
- **`src/cli/rates.mjs`** — add `--share-weights` and `--persistent` flag handling to `runRefit`.
- **`src/consent.mjs`** — extend the consent record shape to include `weights_share_enabled` (boolean).
- **`bin/claude-meter.mjs`** — add `--share-weights` and `--persistent` flags.

### Server side (out of scope for THIS repo)
The meter API server implementation of `POST /api/v1/weights` lives in `cnighswonger/claude-code-meter-api` and is tracked separately. The phase-4 directive in this repo locks the client-side wire contract; the server-side acceptance contract will be reviewed against the same wire shape in that repo.

### Tests (phase 4)

`test/rates-history-ledger-phase4.test.mjs` — 6 tests:

1. `--share-weights` without prior consent → emits the "run `claude-meter consent` first" error and exits non-zero.
2. `--share-weights` with consent → POSTs the ledger's fits; mock server confirms request shape matches the wire contract.
3. `--share-weights --persistent` writes `weights_share_enabled: true` to `CONFIG_FILE` (`~/.claude/claude-meter-config.json`); subsequent invocations read that field via `readConfig` and auto-publish.
4. Scheduled refit (phase 3 path) with `weights_share_enabled: true` in consent auto-publishes after the refit.
5. Network failure → CLI exits non-zero, error message names the endpoint and the operator's recourse (`--no-share` retry).
6. Server returns 4xx → CLI surfaces the server's error body verbatim.

## Test plan (master)

Beyond per-phase test suites:

- After phase 1 lands on the parent branch: `node --test test/*.test.mjs` → no cross-suite regressions.
- After phase 2: same check, plus manual smoke of drift detection by hand-editing the ledger to simulate a 30% cache_create weight shift.
- After phase 3: same check, plus manual smoke by setting the system clock forward 29 days (or mocking `Date.now()`) and confirming the cadence trigger fires.
- After phase 4: same check, plus end-to-end smoke against the meter API server's `/api/v1/weights` once that server-side work lands.

## Verification

Per phase, as the implementations land. The master directive does not produce code on its own — it locks the contract.

## Out of scope (master)

- **Cadence anchoring to plan-renewal day-of-month.** v1 uses rolling 28-day window. Day-of-month anchoring deferred to a follow-up after we have data on whether operators care.
- **De-duplication of consecutive identical fits in the ledger.** v1 appends always. If operators report ledger bloat from frequent manual `--refit` calls, add de-dup in a follow-up.
- **Configurable drift threshold.** Hard-coded 15% in v1.
- **Dashboard rendering of weight history.** The meter dashboard at `web/` is a separate surface and is not part of this directive. A future PR could add a chart, but that's its own contract.
- **Server-side `POST /api/v1/weights` implementation.** Tracked separately in `cnighswonger/claude-code-meter-api`. This repo's phase 4 ships the client; server-side work is sequenced after the wire contract is locked.
- **Backfill of historic fits from old `claude-meter.jsonl`.** v1 starts ledger-empty. Operators get one fit per refit cycle going forward.

## Process

Master directive locks the four-phase contract. Each phase ships as its own sub-PR on `feature/rates-history-ledger-phase{1..4}` against `feature/rates-history-ledger` (the parent) — sub-branches use hyphens per CLAUDE.md (`feature/<name>-<phase>`) since git won't allow nested refs when the parent ref exists.

Per-phase PR review chain:
1. Phase implementation lands on its sub-branch.
2. Codex review per phase (each phase gets its own `docs/code-reviews/rates-history-ledger-phaseN-impl-rN-codex.md`).
3. Phase merges into the parent on Codex APPROVE + Lead approve.
4. Once all four phase PRs are merged into the parent, the parent merges into `main` as a single squash with the per-phase commit history preserved in the PR description.

If during implementation any phase needs to amend the master contract, the amendment lands on the parent branch BEFORE the phase implementation continues — same pattern as the rates-windowing directive's r2/r2.1 amendments.

— Proxy Builder
