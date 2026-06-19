# Directive: Phase 4 — weight-history public-share endpoint client (`POST /api/v1/weights`)

**Issue:** [#34](https://github.com/cnighswonger/claude-code-meter/issues/34) (phase 4 of 4)
**Master directive:** `docs/directives/rates-history-ledger.md` (merged `63cc0b9`) — §"Phase 4 — public-share endpoint (load-bearing)" and its "Minimum wire-contract lock list"
**Branch:** `feature/rates-history-ledger-phase4`
**Stage:** directive — round 1
**Milestone:** v0.9.0 (contemporaneous with the `--by row` removal)

## Goal

Lock the **client-side** wire contract for `POST /api/v1/weights` so an operator who has consented can publish their weight-history ledger to the community dataset. This directive does NOT ship implementation — it pins the six contract points the master directive deferred, so implementation review can check code against a fixed target. The server-side endpoint lives in `cnighswonger/claude-code-meter-api` and is reviewed against this same wire shape there.

## Why this is load-bearing (and what that requires)

This is the first phase of #34 that crosses a **wire boundary**. Phases 1–3 were CLI + local-disk only; this phase defines a request/response contract that a separate server must accept, and it transmits an operator's recovered Q5h weights off-machine. Per `CLAUDE.md` and the master directive's NFR:

- **Load-bearing → human (Chris) review required before merge**, in addition to Lead + Codex. The independent reviewer and the Lead are both LLMs with correlated blind spots; a wire contract that two LLMs agree on can still be wrong in a way only the human catches.
- The implementation PR (separate from this directive PR) is ALSO load-bearing and returns to Chris.

## Non-Functional Requirements

- **Size/complexity budget:** ~80 LOC implementation (`weights-share.mjs` POST client + the `runRefit`/cadence opt-in plumbing + the consent-field accessor) + ~90 LOC tests (mock-server subprocess tests). Reviewers should flag if it drifts materially past 2×.

- **Threat model:** This phase transmits recovered Q5h weights + install_id + consent_token off-machine. Specifics:
  - **What leaves the machine:** the ledger fits (aggregated tier-level regression weights, R², validation error, cache-fix label, model/tier/speed), `install_id` (16-hex random, not PII), `consent_token` (32-hex, derived from install_id + timestamp + scope), `submitted_at`.
  - **What must NEVER leave:** raw per-call rows, session ids, the operator's `--log-file` contents, the `api_key` from the registered-key share path (this endpoint uses the consent-token gate, NOT `X-API-Key`).
  - **Trust boundary:** the client trusts only `meter.vsits.co` (the `DEFAULT_SERVER` constant); the endpoint URL is composed from `DEFAULT_SERVER` + the hard-coded path, never from operator input beyond `--endpoint` (which already exists and is operator's own override).
  - **Consent gate:** publishing requires prior `claude-meter consent`. An operator who has not consented (or has opted out) cannot publish. This is checked before any network call.

- **Maintainability constraints:** one new module (`src/cli/weights-share.mjs`) — justified because the weights endpoint (`/api/v1/weights`, consent-token body gate) is a distinct wire contract from the existing `src/share/client.mjs` (`/api/v1/submit`, `X-API-Key` header gate). Inlining would entangle two endpoints' auth models in one module. No new HTTP abstraction — reuse `globalThis.fetch` exactly as `src/cli/analyze.mjs:772` and `src/share/client.mjs:25` already do. No retry/backoff subsystem (v1 is single-shot, matching the existing share client).

- **Performance/reliability:** one POST per opt-in publish; payload bounded at 100 fits (see §3 below). No perf concern. Reliability: a publish failure must NEVER block or corrupt the local refit — the fit is already persisted to the ledger before the publish is attempted; a failed publish exits non-zero with a clear message but leaves the ledger intact.

- **Load-bearing? YES.** New wire-format contract with cross-repo coupling to `cnighswonger/claude-code-meter-api`. Requires Chris human review before merge (this directive PR AND the implementation PR).

## Repo facts this directive is built on (verified against current `main`)

- `getConsentStatus()` returns `{ consented: true, token, timestamp, installId }` when consented, `{ consented: false, reason }` otherwise (`src/consent.mjs:102`-`:119`). It does **not** return a `consent_token` property — the token is the `token` key.
- `requestConsent(skipInteractive=false)` is `async`, returns the token string or `null` (`src/consent.mjs:128`-`:179`).
- `readConfig()` / `writeConfig(config)` read/write `CONFIG_FILE` = `~/.claude/claude-meter-config.json` (`src/consent.mjs:53`-`:65`, `src/constants.mjs:22`).
- `getInstallId()` returns `config.install_hash` (16-hex, random per install) (`src/consent.mjs:70`-`:77`).
- `DEFAULT_SERVER = "https://meter.vsits.co"` (`src/constants.mjs:39`). No endpoint-path constants exist; paths are hard-coded at call sites.
- The existing `analyze --share` path posts `consent_token` in the body (no `X-API-Key`) to `${endpoint}/api/v1/submit` via `globalThis.fetch` (`src/cli/analyze.mjs:744`-`:790`). This is the precedent the weights endpoint mirrors.
- A ledger fit carries exactly: `fit_at`, `tier`, `tier_started`, `model`, `speed`, `window_count`, `rows_total`, `r_squared`, `weights{input,output,cache_read,cache_create}`, `validation{method,predicted_pp,actual_pp,error_pct}`, `cache_fix_label` (`src/cli/weights-ledger.mjs`, the appendFit shape from `src/cli/rates.mjs` runRefit).

## The six locked contract points

### 1. Auth / consent gate

**Locked:** the `consent_token` field in the request body. NO `X-API-Key` header. This mirrors the `analyze --share` path (`src/cli/analyze.mjs:759`,`:772`-`:777`), not the registered-key `share` subcommand (`src/share/client.mjs`, which uses `X-API-Key`).

Token source:
- One-shot publish (`--share-weights`): `await requestConsent(args.yes)`. Returns the token or `null`; `null` → print "Run `claude-meter consent` to publish weights." and exit non-zero, with no network call.
- Persistent publish (`weights_share_enabled: true` in CONFIG_FILE): `getConsentStatus()`; if `consented`, use `.token`; if not consented, skip publish silently after the refit (the operator opted into auto-publish but later revoked consent — revoke wins, no error spam on every scheduled refit).

### 2. Idempotency / dedup key

**Locked:** composite key `install_id + fit_at + tier + model + speed`. A fit is uniquely identified by when it was computed and its `(tier, model, speed)` keyspace. Resubmitting the same fits (the full-history scope, §5) is therefore idempotent server-side — duplicates are no-ops, not errors. The client does NOT track what it has already sent; it relies on this key for at-least-once-safe republishing.

### 3. Max payload size

**Locked:** 100 fits per request. If the ledger holds more than 100 fits for the in-scope filter, the client sends the **100 most-recent by `fit_at`** and prints a one-line stderr notice (`Ledger has N fits; publishing the 100 most-recent. Pagination is a v2 follow-up.`). Pagination is explicitly deferred — at one monthly fit per (model, tier), 100 fits is ~8 years of single-tier history, so the cap is not a practical limit in v1.

### 4. Server error handling (client side)

**Locked, single-shot, no retry** (matches the existing share client):
- `2xx` → success. Parse the response body (§6) and print the summary.
- `4xx` → terminal. Surface the server's error body **verbatim** (the `error` field if present, else the raw body text), exit non-zero. Do NOT retry — a 4xx means the request is malformed or rejected; retrying won't help.
- `5xx` or network/transport error → terminal in v1. Exit non-zero with a message naming the endpoint URL and the recourse: "Publish failed (`<url>`): `<status-or-error>`. The fit is saved locally; retry with `claude-meter rates --refit --share-weights` or run without `--share-weights`." (This clarifies the master directive's `--no-share` phrasing — there is no `--no-share` flag; the recourse is to omit `--share-weights` or retry.)
- In ALL failure cases the local ledger is already written, so a failed publish never loses a fit.

### 5. Submission scope

**Locked:** full-history, server dedupes. The client sends all in-scope fits (up to the 100 cap, §3). It does NOT track `last_submitted_at` — that state is avoided deliberately; the composite dedup key (§2) makes full-history resubmission idempotent. Simpler client, no drift between a "what I've sent" pointer and reality.

### 6. Server response shape (what the client expects on 2xx)

**Locked:**
```json
{ "accepted": <int>, "rejected": <int>, "errors": [ { "fit_at": "<iso>", "reason": "<string>" } ] }
```
The client prints: `Published <accepted> fit(s) to the community dataset (<rejected> rejected).` If `rejected > 0`, it lists each `errors[].fit_at: reason` line. A 2xx with a body that doesn't parse as this shape is treated as success with a generic "Published." message (forward-compat: the server may add fields).

## Wire payload (locked)

```json
{
  "schema_version": 1,
  "install_id": "<getInstallId()>",
  "consent_token": "<token from requestConsent() or getConsentStatus().token>",
  "submitted_at": "<new Date().toISOString()>",
  "fits": [ <ledger fit object, verbatim — all 11 keys> ]
}
```

`fits[]` entries are the ledger fit objects unchanged (no field stripping) — the fit shape is already aggregated and carries no per-call or session data, so there is nothing to strip. Endpoint URL: `${args.endpoint || DEFAULT_SERVER}/api/v1/weights`.

## Opt-in semantics (locked, from master directive)

- Default: weights are NOT published.
- `claude-meter rates --share-weights` → one-shot publish for this invocation (after the refit/fit it produces).
- `claude-meter rates --share-weights --persistent` → writes `weights_share_enabled: true` to CONFIG_FILE via `writeConfig`; subsequent scheduled refits (Phase 3 cadence) auto-publish.
- Prerequisite: prior `claude-meter consent`. Not consented (or opted out) → no publish.
- The Phase 3 scheduled-refit path, when `weights_share_enabled` is set, publishes the fits it just appended (using the persistent-token source from §1).

## Implementation surface (for the implementation PR — NOT this directive PR)

- **`src/cli/weights-share.mjs`** (NEW, ~45 LOC) — `publishWeights({ fits, endpoint, token, installId })` async POST client. Composes the payload, caps at 100, POSTs via `globalThis.fetch`, returns `{ ok, status, body }` (mirrors `src/share/client.mjs`'s return shape). Pure-ish: no console output; the caller renders.
- **`src/cli/rates.mjs`** — `runRefit` and the Phase 3 cadence path gain the `--share-weights` opt-in: after appending fits, resolve the token (§1), call `publishWeights`, render the result (§6) or the error (§4).
- **`src/consent.mjs`** — add a small accessor for `weights_share_enabled` (read via `readConfig`, write via `writeConfig`). No change to the consent token logic.
- **`bin/claude-meter.mjs`** — add `--share-weights` and `--persistent` booleans + help text; forward to `ratesCommand`. `--persistent` without `--share-weights` is a usage error (exit non-zero).

## Tests (for the implementation PR)

`test/rates-history-ledger-phase4.test.mjs` — 6 tests, using a **local mock HTTP server** (node `http.createServer`, bound to `127.0.0.1:0` for an ephemeral port) since the repo has no existing share-submission test harness to mirror:

1. `--share-weights` without prior consent → "Run `claude-meter consent`" error, exit non-zero, NO request hits the mock server.
2. `--share-weights` with consent → POSTs to `/api/v1/weights`; the mock asserts the request body matches the locked wire shape (schema_version, install_id, consent_token, submitted_at, fits[] with the 11 keys).
3. `--share-weights --persistent` writes `weights_share_enabled: true` to CONFIG_FILE; a subsequent invocation reads it and auto-publishes.
4. Scheduled refit (Phase 3) with `weights_share_enabled: true` → auto-publishes after the refit.
5. Network failure (point the client at a closed port) → exit non-zero, error names the endpoint + recourse, the ledger still contains the fit.
6. Server returns 4xx with an `error` body → client surfaces the error verbatim, exits non-zero.

The mock-server pattern (ephemeral `127.0.0.1` listener + `--endpoint` override + a temp CONFIG_FILE/HISTORY_FILE/ledger via the existing `--ledger-file` injection) is the test-isolation approach; the implementation PR adds a `--config-file` injection flag (mirroring `--ledger-file`/`--drift-seen-file`) so consent state can be set per-test without touching `~/.claude`.

## Out of scope (phase 4)

- **Server-side `/api/v1/weights` implementation** — `cnighswonger/claude-code-meter-api`, tracked separately, reviewed against this wire shape.
- **Pagination beyond 100 fits** — v2 follow-up.
- **Retry/backoff on 5xx** — v1 is single-shot.
- **Unpublish / delete-from-dataset** — not in scope; consent revocation stops future publishes but this directive does not define a retraction path.
- **`X-API-Key` registered-key auth** — the weights endpoint uses the consent-token gate; the registered-key path stays exclusive to `/api/v1/submit` via the `share` subcommand.

## Process

This is a **directive PR** — it locks the contract and gets Lead + Codex + **Chris** review (load-bearing). Implementation lands in a separate PR on this same branch (or a follow-up sub-branch) AFTER the contract is approved, and that implementation PR also returns to Chris before merge. The server-side PR in the meter-api repo references this directive's wire shape as its acceptance contract.

— Proxy Builder
