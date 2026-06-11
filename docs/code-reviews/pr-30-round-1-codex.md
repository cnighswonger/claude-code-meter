Verdict: APPROVE_WITH_NITS

# Review: PR #30 — `agent_id` + `agent_id_source` directive

Date: 2026-06-11
Reviewed: `docs/directives/agent-id-schema-addition.md` at `c6e613f`
Round: 1
Label applied: `reviewed-by-codex-agent`, `approved-by-codex-agent`

## What Is Correct

- The directive now resolves the round-1 contract contradiction the right way: `.superRefine()` is explicitly in scope at `docs/directives/agent-id-schema-addition.md:50`, the asymmetric invariant is spelled out in both Scope and Test plan, and the only current strict-validation chokepoints remain `src/log/writer.mjs:68` and `src/ingest/jsonl-tailer.mjs:148`. I rechecked the tree and found no current `MeterRowSchema` `.shape` / `.extend` / `.pick` consumers in `src/` or `test/`, so the `ZodEffects` wrap is safe for today's codebase.
- Snake_case alignment is now consistent on the meter side (`docs/directives/agent-id-schema-addition.md:13`, `:17`, `:49`, `:71-74`, `:95`) and matches the merged companion directive in `cnighswonger/claude-code-cache-fix#215` at merge commit `3f7b747`, which also uses `cc_header` / `cache_fix_derived`.
- Release ordering remains correct and load-bearing at `docs/directives/agent-id-schema-addition.md:25` and is mutually consistent with the cache-fix side: meter directive merges first, meter v0.8.0 ships, then the cache-fix implementation may merge. The attestation-breach symptom is now documented against the actual reject paths in `src/log/writer.mjs:68-71` and `src/ingest/jsonl-tailer.mjs:148-152`.
- Field shapes and rollout rules are coherent. `request_id` already establishes the `max(64)` precedent at `src/log/schema.mjs:40-48`; the proposed `agent_id: z.string().max(64).optional()` matches that shape, the enum is closed, and the directive explicitly says future enum-value additions repeat the meter-first rollout discipline without a schema-version bump.
- `Issue: TBD` is honestly deferred with an explicit "will be filed alongside this directive" commitment at `docs/directives/agent-id-schema-addition.md:3`, which is acceptable at directive stage so long as it is cleared before the implementation PR opens.

## What Needs Attention

1. The test plan still omits a write/read-back preservation case. `docs/directives/agent-id-schema-addition.md:64-78` now covers the validation edges well, but it never names one round-trip test that writes a valid row carrying `agent_id` / `agent_id_source`, reads it back through the real validation surface, and asserts both fields survive unchanged. For a load-bearing wire-format addition, that end-to-end preservation check should be in the implementation plan alongside the unit cases.

## Precision / Tightenings

- The `ZodEffects` wrap note should name `.pick` alongside `.shape` and `.extend`. The directive correctly flags the wrap at `docs/directives/agent-id-schema-addition.md:50` and `:98`, but future maintainers attempting `MeterRowSchema.pick(...)` will hit the same surprise as `.shape` / `.extend` users.
- `docs/directives/agent-id-schema-addition.md:25`, `:51`, and `:98` imply that the operator-attestation contract lives in the schema comment block, but the explicit comment-block requirements name the env-var and rollout coupling more clearly than the attestation language itself. One sentence making "`CACHE_FIX_USAGE_LOG_AGENT_ID=on` is the operator's attestation that meter v0.8.0+ is installed" explicit in the comment-block spec would remove that ambiguity.
- `docs/directives/agent-id-schema-addition.md:48` calls the placement "alphabetical-ish ordering", but `agent_id` sorts before `request_id`. The real rationale is grouping the two cache-fix-sourced attribution fields together. Cosmetic, but easy to tighten.

## Bloat / Non-Functional

- The NFR budget is slightly stale. `docs/directives/agent-id-schema-addition.md:29` still says "~10 LOC schema addition"; with the `.superRefine()` block and its wrap commentary, the schema-side change is now closer to ~15-20 LOC. Still trivial, but the estimate should match the actual shape.

## Recommendations

1. Add one round-trip preservation test to the implementation test plan.
2. Expand the `ZodEffects` warning to `.shape` / `.extend` / `.pick`, and make the comment-block's attestation sentence explicit.
3. Update the stale schema LOC estimate while the directive is still in review.

## Bottom Line

The substantive wire-contract work is in good shape. I re-verified the safety premise behind the `.superRefine()` wrap, the snake_case byte-contract alignment with cache-fix #215, and the release-ordering / failure-mode language; those all check out. The remaining issues are narrow directive-quality nits, not blockers to implementation, so this is APPROVE_WITH_NITS.

— Codex review
