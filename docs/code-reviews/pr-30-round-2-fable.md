# PR #30 — Fable round-2 review (directive: `agent_id` + `agent_id_source` schema addition, v0.8.0)

Verdict: APPROVE

Round 2 of max 2 — focused re-verification of the round-1 APPROVE_WITH_NITS findings against the round-2 directive at `c6e613f` (`docs/directives/agent-id-schema-addition.md`). Re-checked against the current `src/log/schema.mjs`, `src/log/writer.mjs:68`, `src/ingest/jsonl-tailer.mjs:148`, the PR #24 precedent suite (`test/schema-request-id.test.mjs`), the repo's Zod dependency (v3, `zod@3.25.76` under `^3.23.0`), and the companion cache-fix directive (`proxy-workflow-agent-id-synthesis.md`, round-5 amendment) for the cross-repo casing claim.

## Round-1 → round-2 status table

| # | Round-1 finding | Status | Note |
|---|---|---|---|
| A1 | Spec contradicted test plan (two plain optionals can't enforce source-without-value FAILS) | **ADDRESSED** | Option A taken: Scope now names `.superRefine()` enforcing source ⇒ value; test plan carries both the source-without-value FAILS pair (both enum values) and the value-without-source PASSES intent test with documented rationale; Scope and Test Plan now agree on one wire contract. |
| A2 | Enum casing kebab-case vs the schema's snake_case convention | **ADDRESSED** | Migrated to `cc_header`/`cache_fix_derived` everywhere (Goal, casing paragraph, Scope, test plan incl. a kebab-rejection test, reviewer checklist), named as a byte-for-byte wire contract; verified the cache-fix #215 directive's round-5 amendment carries the parallel migration including `drift_canary` for its event-log value. |
| A3 | Failure-mode loudness of attestation breach (silent shrinking data) | **ADDRESSED** | CHANGELOG spec now includes the full symptom paragraph — nonzero `skipped=` count on `claude-meter ingest`, `CLAUDE_METER_DEBUG=1` visibility, plus the legacy-writer silent-drop caveat I hadn't even asked for. |
| A4 | Test plan should mirror full `request_id` precedent suite | **ADDRESSED** | 64/65-char boundary pair, non-string type rejection (`123`, `null`, `true`, array, object), unknown-sibling-key strictness, and the value-without-source intent test are all now specified, plus a `request_id` regression check. (The precedent's 1-char-minimum test isn't mirrored; immaterial — same `max(64)`-only shape.) |
| A5 | Enum extension re-triggers rollout discipline — needs comment-block note | **ADDRESSED** | Scope and reviewer checklist both require the comment block to note future enum-value additions repeat meter-first/emitter-second ordering with no version bump. |
| B1 | Branch field wrong (`feature/…` vs `directive/…`) | **ADDRESSED** | Header now names `directive/agent-id-schema-addition` as the directive branch and labels `feature/agent-id-schema-addition` as the planned implementation branch, with the correction noted. |
| B2 | `Issue: TBD` | **HONESTLY DEFERRED** | Still TBD, but now annotated "will be filed alongside this directive" — an explicit commitment rather than a dangling reference. Acceptable; the issue must exist before the implementation PR opens. |
| B3 | "Ignore them cleanly when reading" wording hazard (Goal section) | **ADDRESSED** | The misleading sentence is gone; the Goal now correctly states v0.7.x installs tail-reject unknown keys. (Grammar nit: "older meter installs (v0.7.x) tail-rejecting unknown keys" is missing its verb — "tail-reject". Cosmetic.) |
| B4 | `usage-log.mjs` comment-block conflation in Why section | **ADDRESSED** | Why section now correctly attributes `usage-log.mjs:40-44` to the cache-fix emitter and locates the meter side of the contract in this PR's CHANGELOG + schema comment block. |

## Re-verification of the safety premise behind A1

The `.superRefine()` fix rests on my round-1 claim that nothing consumes `MeterRowSchema.shape`/`.extend`. Re-confirmed against the current tree: the only `MeterRowSchema` call sites in `src/` remain `writer.mjs:68` (`safeParse`) and `jsonl-tailer.mjs:148` (`parse`); no `.shape`/`.extend`/`.pick`/`.omit`/`.merge` usage anywhere in `src/` or `test/`. The repo pins Zod 3 (`zod@^3.23.0`, 3.25.76 installed), where `.superRefine()` does wrap into `ZodEffects` exactly as the directive states, and the directive correctly documents both the wrap and the unwrap-first constraint for future `.shape`/`.extend` users in the comment-block spec (checklist item d). The unknown-sibling-key test in the plan correctly guards that the wrap doesn't disturb strict-object rejection. The premise holds; the fix is sound.

## New issues (net-new sweep)

None blocking. Three informational notes, none requiring another round:

1. **NFR budget is slightly stale.** "~10 LOC schema addition" predates the `.superRefine()` block, which realistically pushes the schema diff to ~15–20 LOC. The budget is labeled approximate and the change remains trivial; the implementer should not treat 10 LOC as a ceiling.
2. **"Alphabetical-ish ordering" mislabels the placement.** `agent_id` sorts before `request_id` alphabetically; the actual (and correct) rationale is chronological grouping with the other cache-fix-sourced attribution field. Cosmetic.
3. **Cross-repo citation freshness, one-way.** The meter directive's "round-N update" phrasing (Goal casing paragraph) is vague where the cache-fix directive names round-5 specifically — substance is consistent, so no flag under my round-1 standard. Conversely, the cache-fix directive still cites meter PR #30 at commit `88c7c0c` (round-1 HEAD, now `c6e613f`); that staleness lives on the cache-fix side and is PB's to route, noted here only for the cross-repo record.

## Recommendations

1. Fix the "tail-rejecting" verb and "alphabetical-ish" label during implementation — neither needs a directive round.
2. File the tracking issue before (or with) the implementation PR, per the B2 commitment.
3. Implementation reviewer should confirm the emitted enum byte sequences against the cache-fix emitter once that PR exists — the directive's wire-contract language makes this checkable.

## Bottom Line

All eight round-1 items are addressed or honestly deferred. The one substantive defect — the schema/test-plan contradiction — is resolved the right way: `.superRefine()` with the asymmetric invariant made explicit, the ZodEffects consequence documented, and the safety premise (no `.shape`/`.extend` consumers) re-verified true against the current tree and the repo's actual Zod major version. The enum casing is migrated to snake_case in both repos' directives simultaneously, exactly as recommended, with the kebab-rejection test pinning the migration. The remaining notes are cosmetic wording and a stale LOC estimate. The directive is internally consistent and ready for implementation under its own checklist, including the Chris human-review gate for the load-bearing merge. APPROVE.

— Fable 5 Review Agent
