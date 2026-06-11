# Directive: add `agent_id` + `agent_id_source` to MeterRowSchema for Workflow-agent attribution

**Issue:** TBD (will be filed alongside this directive)
**Directive branch:** `directive/agent-id-schema-addition` (current PR #30). **Implementation branch (planned):** `feature/agent-id-schema-addition` — round-1 directive accidentally used the implementation branch name as the directive's own branch field; corrected.
**Stage:** directive — round 3 / `approved-by-codex-agent` (Codex round-1 APPROVE_WITH_NITS at `c6e613f` cleared the contract correctness; this commit folds in the non-blocking Codex + Fable round-2 nits before AITL synthesis. Prior rounds addressed Fable round-1 APPROVE_WITH_NITS then Fable round-2 APPROVE.)
**Milestone:** v0.8.0 (minor — additive optional fields, schema version stays at `v: 1`)

## Goal

Add two optional fields to `MeterRowSchema` in `src/log/schema.mjs`:

- `agent_id` — string, max 64, optional. The attribution key for the request.
- `agent_id_source` — enum string `"cc_header" | "cache_fix_derived"`, optional. The provenance of the `agent_id` value (canonical CC `x-claude-code-agent-id` header pass-through vs. cache-fix proxy-derived for Workflow-tool subagents whose canonical headers are absent).

Both fields strict-typed per the schema's `z.strictObject` discipline. Schema version stays at `v: 1` (additive optional fields don't require a version bump). v0.8.0+ meter installs accept and parse the new fields; older meter installs (v0.7.x) tail-reject unknown keys, so the cross-repo rollout discipline is mandatory (see Meter compatibility section).

**Enum casing (closes Fable round-1 nit #2):** the values are snake_case (`cc_header`, `cache_fix_derived`) to match the meter schema's universal convention — every existing enum/enum-like value in this file is snake_case or bare lowercase (`five_hour`/`seven_day` in `qrepresentative_claim`, `max_5`/`max_20`/`enterprise` in `plan_tier`, `standard`/`fast`/`mixed` in `speed`). The `qclaim`/`qstatus` value regexes are `[a-z_]*` and `[a-z0-9_]*` — hyphens aren't even representable there. The round-1 directive used kebab-case (`cc-header`/`cache-fix-derived`); round-2 aligns to the established convention. **This is a wire contract — the cache-fix emitter at `proxy/extensions/usage-log.mjs` must use the exact same snake_case byte sequences.** The companion cache-fix #215 directive's round-N update applies the same change.

## Why

Per CC#66761 (closed without retroactive fix-commitment), CC sets `x-claude-code-agent-id` on Task/Agent-tool subagents but NOT on Workflow-tool–spawned subagents. Operators running fan-out workflows (`agent()`, `parallel()`, `pipeline()`) cannot attribute per-Workflow-leg cost without this gap closed at the meter layer.

The `cnighswonger/claude-code-cache-fix` directive `proxy-workflow-agent-id-synthesis.md` (PR #215 on the cache-fix repo) addresses the proxy side: in-proxy derivation of a stable per-leg id from Workflow markers in the request body, stashed on `ctx.meta._workflowAgentId = { id, parentId, source }`. The meter side is this directive — adding the fields the proxy can emit.

**The release ordering is load-bearing.** The cache-fix directive treats this meter directive as a hard prerequisite: the cache-fix implementation PR cannot open until this directive has been filed; the cache-fix implementation PR cannot merge until meter v0.8.0 has shipped. This is the same pattern the `request_id` rollout used (cache-fix v4.1.0 → v4.2.0) and the same pattern that the cache-fix emitter's comment block at `proxy/extensions/usage-log.mjs:40-44` describes as the operator-attestation contract. The meter side of that contract lives in this directive's CHANGELOG and the schema comment block this PR adds.

## Non-Functional Requirements

- **Size/complexity budget:** ~15–20 LOC schema addition (additive fields + the `.superRefine()` wrap) + ~30–40 LOC tests + CHANGELOG entry. Trivial. Closes Codex round-1 nit on stale LOC estimate that predated the refine wrap.
- **Threat model:** `agent_id` is opaque (16-hex chars when proxy-derived, or whatever canonical CC value is when source is `cc_header`). No PII. No new sensitive surface. Same threat profile as the existing `sid` and `request_id` fields.
- **Maintainability constraints:** no new abstractions; the fields drop into the existing strict-object pattern alongside `request_id`.
- **Performance/reliability:** read-side cost is one optional-field check per row. Sub-microsecond. No I/O.
- **Load-bearing? Yes.** This is a `MeterRowSchema` wire-format addition with cross-repo coupling to `cnighswonger/claude-code-cache-fix`. Schema additions to `z.strictObject` require the rollout-ordering discipline (meter schema first, cache-fix emission gated default-off, default flip one release later) documented inline in `cache-fix/proxy/extensions/usage-log.mjs:40-44`. Per the cross-repo standard, load-bearing changes require Chris human review before merge in addition to the routine Lead + Codex review path.

## Schema decision

The two fields share a single attribution event but split across two columns intentionally:

- **`agent_id`** is the value applications (dashboard filters, per-agent burn-rate reports) consume.
- **`agent_id_source`** is the provenance applications display when the value's origin matters (canonical CC-header values are authoritative; cache-fix-derived values are heuristic and should be marked as such on any dashboard that shows them).

Alternative considered: a single object field `agent: { id, source }`. Rejected — `z.strictObject` rows are flat by convention (see how `sid`, `request_id`, `model`, etc. are all top-level), and nested objects complicate the consumers' downstream group-by queries.

## Scope

In scope:

- Add `agent_id: z.string().max(64).optional()` to `MeterRowSchema` after `request_id` (grouping with the other cache-fix-sourced attribution field, NOT alphabetical — closes Codex round-1 nit on mislabeled rationale).
- Add `agent_id_source: z.enum(["cc_header", "cache_fix_derived"]).optional()` after `agent_id`.
- **Apply a `.superRefine()` on the schema object** enforcing the asymmetric invariant: `agent_id_source` present ⇒ `agent_id` present. The reverse is allowed (`agent_id` present without `agent_id_source` validates per Zod's `.optional()` rule, and the schema comment documents this as "value-without-source validates; the canonical/derived provenance is recoverable from `sid` correlation if the row carries `request_id` and the proxy event log is available"). Closes Fable round-1 nit #1: round-1 directive named two plain `.optional()` fields AND required "source-without-value fails validation" — two independent optionals cannot enforce that. The refine wraps `z.strictObject` into `ZodEffects`; I verified nothing in `src/` consumes `MeterRowSchema.shape`, `.extend()`, or `.pick()` (Fable confirmed; `src/log/writer.mjs:68` and `src/ingest/jsonl-tailer.mjs:148` are the only validation chokepoints, both use `.safeParse()`/`.parse()`), so the wrap is safe today. Future maintainers extending the schema via `.shape` / `.extend` / `.pick` need to unwrap the refine first; the comment block documents this constraint.
- Update the schema's leading comment block to document both fields, citing CC#66761 as the upstream gap they close, citing `cnighswonger/claude-code-cache-fix/docs/directives/proxy-workflow-agent-id-synthesis.md` as the proxy-side directive that emits them, naming the snake_case casing as a wire-contract requirement (the emitter must use the exact same byte sequences), and including an explicit attestation sentence: **`CACHE_FIX_USAGE_LOG_AGENT_ID=on` is the operator's attestation that meter v0.8.0+ is installed; setting it without upgrading meter produces rows that the older meter's tailer rejects** (closes Codex round-1 precision nit on attestation-contract clarity in the comment block). Also note that **future enum-value additions** (e.g. a third `agent_id_source` value for dashboard-manual attribution) re-trigger the meter-first/emitter-second rollout discipline — old meters reject rows carrying new enum values for the same reason they reject rows carrying new keys. No schema version bump by the same logic, but the rollout-ordering work must repeat.
- CHANGELOG entry for v0.8.0 explaining the addition, the cache-fix coupling, the cache-fix env-var `CACHE_FIX_USAGE_LOG_AGENT_ID=on` that emits them, the operator-attestation contract (operator setting the env-var WITHOUT upgrading their meter would produce rows that fail validation — that's the operator's responsibility, not a runtime guarantee), and **the observable symptom of an attestation breach** (closes Fable round-1 nit #3): "If you set `CACHE_FIX_USAGE_LOG_AGENT_ID=on` against meter v0.7.x or older, every row emitted with the field is rejected by the tailer. The visible symptom is a nonzero `skipped=` count in `claude-meter ingest` tick output, plus the row never appearing in the dashboard. Under `CLAUDE_METER_DEBUG=1` the skip is logged with the validation error. The legacy writer path drops the row silently with no log — operators relying on `claude-meter write` should verify their meter version before flipping the env-var."

Out of scope:

- Dashboard UI surfacing of the new fields. That's a follow-up dashboard directive once data starts flowing.
- Any downstream aggregator that groups by `agent_id`. Same — separate work.
- Schema version bump. Additive optional fields don't trigger one.

## Implementation choice

The change is small but two design decisions matter: (1) the `.superRefine()` wrap (above) is the only viable way to enforce the asymmetric source⇒value invariant against `z.strictObject`; (2) the snake_case enum casing matches the schema's universal convention. The leading comment block already documents the `request_id` rollout pattern; the new fields' comment should mirror that exactly so the rollout contract is visible to future maintainers, AND should add the two new notes above (casing as wire contract + enum-extension re-triggers rollout discipline).

## Test plan

Following the `request_id` precedent suite shape (`test/schema-request-id.test.mjs`) for parity (closes Fable round-1 nit #4):

- Unit: row with `agent_id` + `agent_id_source` present validates.
- Unit: row with both absent validates (back-compat with current cache-fix installs).
- Unit: row with `agent_id` present + `agent_id_source` absent validates (intended behavior per the schema-comment doc; value-without-source is acceptable because the canonical/derived provenance is recoverable from `sid` correlation if `request_id` is present).
- Unit: row with `agent_id_source: "cc_header"` + `agent_id` absent FAILS validation (the `.superRefine()` enforces source ⇒ value).
- Unit: row with `agent_id_source: "cache_fix_derived"` + `agent_id` absent FAILS validation (same refine, both enum values).
- Unit: row with `agent_id_source: "cc-header"` (kebab-case) FAILS validation (enum strictness; documents the kebab→snake migration).
- Unit: row with `agent_id_source: "anything_not_in_enum"` FAILS validation (enum strictness).
- Unit: 64-char `agent_id` boundary accept + 65-char `agent_id` boundary reject (mirroring the `request_id` boundary test).
- Unit: non-string `agent_id` types rejected (`123`, `null`, `true`, array, object).
- Unit: unknown-sibling-key strictness preserved (a row with a `garbage_field` is rejected, confirming `.superRefine()` did not break `z.strictObject`'s rejection of unknown keys).
- Unit: existing `request_id` rollout test continues to pass (regression check).
- **Round-trip preservation:** end-to-end test that writes a valid row carrying `agent_id` + `agent_id_source` through the real `writer.mjs` validation surface, reads it back through `jsonl-tailer.mjs`, and asserts both fields survive unchanged (closes Codex round-1 nit). The end-to-end check is the canonical guard against any future schema or writer refactor accidentally dropping or coercing the fields, and it is the test the operator-attestation contract ultimately depends on.

## Files modified / created

Modified:

- `src/log/schema.mjs` — add the two optional fields; update leading comment block.
- `CHANGELOG.md` — v0.8.0 entry.
- `README.md` — schema reference update.

Created:

- `test/schema-agent-id.test.mjs` — the unit tests above.

## Reviewer checklist (meter side)

- [ ] Both fields are `.optional()` and strict-typed.
- [ ] **Enum values are snake_case** (`cc_header`, `cache_fix_derived`) — NOT kebab-case. Matches the schema's universal convention (`five_hour`, `max_5`, `enterprise`, `standard`/`fast`/`mixed`). Wire contract: emitter at `proxy/extensions/usage-log.mjs` uses the exact same snake_case byte sequences.
- [ ] `.superRefine()` enforces source ⇒ value invariant. Value-without-source validates intentionally; source-without-value FAILS.
- [ ] Schema version stays at `v: 1` (the addition is additive-optional).
- [ ] Leading comment block documents: (a) cache-fix proxy-side coupling + env-var, (b) snake_case casing as wire contract, (c) `.superRefine()` semantics, (d) unwrap-required-for-`.shape` / `.extend` / `.pick` constraint, (e) future enum-value extensions re-trigger meter-first rollout discipline, (f) explicit attestation sentence (`CACHE_FIX_USAGE_LOG_AGENT_ID=on` ⇒ operator attests meter v0.8.0+ installed).
- [ ] CHANGELOG cites CC#66761 + `cnighswonger/claude-code-cache-fix#215` explicitly, AND includes the attestation-breach symptom paragraph (closes Fable round-1 nit #3): nonzero `skipped=` counter on `claude-meter ingest`, debug-log visibility, legacy-writer silent-drop caveat.
- [ ] Test plan covers the full `request_id` precedent shape (64/65-char boundary, type rejection, unknown-sibling-key strictness) plus the asymmetric-invariant cases unique to this PR.
- [ ] All validation tests pass; existing `request_id` regression test still passes.
- [ ] **Load-bearing? Yes** — Chris human review required before merge (per CLAUDE.md).

## Out of scope (explicit)

- Dashboard UI work.
- Schema version bump.
- Cross-repo coordination beyond the meter side. The cache-fix side is the responsibility of the proxy directive at `cnighswonger/claude-code-cache-fix/docs/directives/proxy-workflow-agent-id-synthesis.md`.

— AI Team Lead
