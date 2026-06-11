# Directive: add `agent_id` + `agent_id_source` to MeterRowSchema for Workflow-agent attribution

**Issue:** TBD (will be filed alongside this directive)
**Branch:** `feature/agent-id-schema-addition`
**Stage:** directive (round 1)
**Milestone:** v0.8.0 (minor — additive optional fields, schema version stays at `v: 1`)

## Goal

Add two optional fields to `MeterRowSchema` in `src/log/schema.mjs`:

- `agent_id` — string, max 64, optional. The attribution key for the request.
- `agent_id_source` — enum string `"cc-header" | "cache-fix-derived"`, optional. The provenance of the `agent_id` value (canonical CC `x-claude-code-agent-id` header pass-through vs. cache-fix proxy-derived for Workflow-tool subagents whose canonical headers are absent).

Both fields strict-typed per the schema's `z.strictObject` discipline. Schema version stays at `v: 1` (additive optional fields don't require a version bump). Existing meter consumers that don't yet know about these fields ignore them cleanly when reading; cache-fix proxy installs that don't yet emit them produce rows that pass schema validation unchanged.

## Why

Per CC#66761 (closed without retroactive fix-commitment), CC sets `x-claude-code-agent-id` on Task/Agent-tool subagents but NOT on Workflow-tool–spawned subagents. Operators running fan-out workflows (`agent()`, `parallel()`, `pipeline()`) cannot attribute per-Workflow-leg cost without this gap closed at the meter layer.

The `cnighswonger/claude-code-cache-fix` directive `proxy-workflow-agent-id-synthesis.md` (PR #215 on the cache-fix repo) addresses the proxy side: in-proxy derivation of a stable per-leg id from Workflow markers in the request body, stashed on `ctx.meta._workflowAgentId = { id, parentId, source }`. The meter side is this directive — adding the fields the proxy can emit.

**The release ordering is load-bearing.** The cache-fix directive treats this meter directive as a hard prerequisite: the cache-fix implementation PR cannot open until this directive has been filed; the cache-fix implementation PR cannot merge until meter v0.8.0 has shipped. This is the same pattern the `request_id` rollout used (cache-fix v4.1.0 → v4.2.0) and the same pattern that `MeterRowSchema`'s comment block in `usage-log.mjs` describes as the operator-attestation contract.

## Non-Functional Requirements

- **Size/complexity budget:** ~10 LOC schema addition + ~30 LOC tests + CHANGELOG entry. Trivial.
- **Threat model:** `agent_id` is opaque (16-hex chars when proxy-derived, or whatever canonical CC value is when source is `cc-header`). No PII. No new sensitive surface. Same threat profile as the existing `sid` and `request_id` fields.
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

- Add `agent_id: z.string().max(64).optional()` to `MeterRowSchema` after `request_id` (alphabetical-ish ordering within the schema).
- Add `agent_id_source: z.enum(["cc-header", "cache-fix-derived"]).optional()` after `agent_id`.
- Update the schema's leading comment block to document both fields, citing CC#66761 as the upstream gap they close and citing `cnighswonger/claude-code-cache-fix/docs/directives/proxy-workflow-agent-id-synthesis.md` as the proxy-side directive that emits them.
- Add validation tests: rows with both fields present validate; rows with both absent validate (back-compat); rows with `agent_id_source` set but `agent_id` absent fail validation (the source field is meaningless without the value); rows with `agent_id_source: "garbage"` fail validation (enum strictness).
- CHANGELOG entry for v0.8.0 explaining the addition, the cache-fix coupling, the cache-fix env-var `CACHE_FIX_USAGE_LOG_AGENT_ID=on` that emits them, and the operator-attestation contract (operator setting the env-var WITHOUT upgrading their meter would produce rows that fail validation — that's the operator's responsibility, not a runtime guarantee).

Out of scope:

- Dashboard UI surfacing of the new fields. That's a follow-up dashboard directive once data starts flowing.
- Any downstream aggregator that groups by `agent_id`. Same — separate work.
- Schema version bump. Additive optional fields don't trigger one.

## Implementation choice

The change is small enough that there's no design decision beyond "add the fields in the right place per the existing schema layout." The leading comment block already documents the request_id rollout pattern; the new fields' comment should mirror that exactly so the rollout contract is visible to future maintainers.

## Test plan

- Unit: row with `agent_id` + `agent_id_source` present validates.
- Unit: row with both absent validates (back-compat with current cache-fix installs).
- Unit: row with `agent_id_source` set but `agent_id` absent fails validation.
- Unit: row with `agent_id` set but `agent_id_source` absent — currently this validates per Zod's optional rule, but the schema comment should say this is "operator should set both or neither; sources without values are an emission bug."
- Unit: row with `agent_id_source: "anything-not-in-enum"` fails validation.
- Unit: existing `request_id` rollout test continues to pass (regression check).

## Files modified / created

Modified:

- `src/log/schema.mjs` — add the two optional fields; update leading comment block.
- `CHANGELOG.md` — v0.8.0 entry.
- `README.md` — schema reference update.

Created:

- `test/schema-agent-id.test.mjs` — the unit tests above.

## Reviewer checklist (meter side)

- [ ] Both fields are `.optional()` and strict-typed.
- [ ] Schema version stays at `v: 1` (the addition is additive-optional).
- [ ] Leading comment block documents the cache-fix proxy-side coupling and the env-var `CACHE_FIX_USAGE_LOG_AGENT_ID=on`, mirroring the `request_id` rollout pattern.
- [ ] CHANGELOG cites CC#66761 + `cnighswonger/claude-code-cache-fix#215` (the proxy-side directive) explicitly.
- [ ] All validation tests pass; existing `request_id` regression test still passes.

## Out of scope (explicit)

- Dashboard UI work.
- Schema version bump.
- Cross-repo coordination beyond the meter side. The cache-fix side is the responsibility of the proxy directive at `cnighswonger/claude-code-cache-fix/docs/directives/proxy-workflow-agent-id-synthesis.md`.

— AI Team Lead
