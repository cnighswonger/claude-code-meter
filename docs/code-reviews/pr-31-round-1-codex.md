Codex review:

# Review: agent-id-schema-addition implementation (PR #31)

Date: 2026-06-13
Reviewed: PR #31 at `7ba2ee34041096a1d6040bf6f56e7e4e8cf739e9`
Round: 1
Verdict: REQUEST_CHANGES
Label applied: changes-requested

## What Is Correct

- [src/log/schema.mjs](src/log/schema.mjs#L6) matches the directive's wire contract. `agent_id` and `agent_id_source` are optional, `agent_id_source` uses snake_case enum values (`cc_header`, `cache_fix_derived`), the fields are placed immediately after `request_id`, and the schema version remains `v: 1` at [src/log/schema.mjs](src/log/schema.mjs#L71).
- The `.superRefine()` implementation is correct. I verified the actual Zod path on the branch: `MeterRowSchema` is a `ZodEffects`, `safeParse()` accepts rows with both fields or value-without-source, and rejects source-without-value with a custom issue on `agent_id` as implemented at [src/log/schema.mjs](src/log/schema.mjs#L126).
- The expanded schema comment block covers the required contract points: cache-fix coupling and env-var gating, snake_case as a wire contract, asymmetric `.superRefine()` semantics, the unwrap requirement for `.shape` / `.extend()` / `.pick()`, future enum-extension rollout discipline, and the explicit operator-attestation sentence. See [src/log/schema.mjs](src/log/schema.mjs#L12).
- The CHANGELOG entry includes both required references and the attestation-breach symptom details: [CHANGELOG.md](CHANGELOG.md#L7) cites CC#66761 and `cnighswonger/claude-code-cache-fix#215`, and [CHANGELOG.md](CHANGELOG.md#L14) covers the `skipped=` symptom, debug visibility, and the legacy writer silent-drop caveat.
- The new schema test file does cover the `request_id` precedent shape for the new fields: 64/65-char boundaries, 1-char acceptance, type rejection sweep, strict-object preservation, back-compat, both enum values, kebab-case rejection, unknown-enum rejection, and the asymmetric invariant. See [test/schema-agent-id.test.mjs](test/schema-agent-id.test.mjs#L50).
- `package.json` was not touched in this PR, so the version bump is correctly deferred to the release-ceremony PR.
- Verification passed on this branch. `npm test` is green, and the Zod runtime check confirms the wrap behaves the way the comment block describes. A direct branch check also shows there are no `MeterRowSchema.shape` / `.extend()` / `.pick()` consumers in `src/` today.

## Blockers

### 1. The required writer/tailer round-trip guard was not implemented

The approved directive requires an end-to-end preservation test that writes a valid row through the real writer surface and reads it back through `jsonl-tailer.mjs` so future refactors cannot silently drop or coerce the new fields: see [docs/directives/agent-id-schema-addition.md](docs/directives/agent-id-schema-addition.md#L79). The implementation does not do that.

The new "round-trip" test at [test/schema-agent-id.test.mjs](test/schema-agent-id.test.mjs#L202) explicitly substitutes a schema-only JSON stringify/parse cycle:

- [test/schema-agent-id.test.mjs](test/schema-agent-id.test.mjs#L203) says "end-to-end via writer.mjs would also create the file on disk".
- [test/schema-agent-id.test.mjs](test/schema-agent-id.test.mjs#L210) only runs `JSON.stringify(row)` / `JSON.parse(serialized)`.
- [test/schema-agent-id.test.mjs](test/schema-agent-id.test.mjs#L212) then re-validates with `MeterRowSchema.safeParse(parsedBack)`.

That does prove the schema preserves the two fields, but it does not exercise the actual load-bearing chokepoints the comment block relies on: [src/log/writer.mjs](src/log/writer.mjs#L68) and [src/ingest/jsonl-tailer.mjs](src/ingest/jsonl-tailer.mjs#L148). If either path later drops, renames, or coerces the fields, this test will stay green. The directive called out the writer/tailer round-trip specifically because the operator-attestation contract depends on those real surfaces, not on a schema-only serialization loop.

## What Needs Attention

- No additional correctness problems stood out after checking the schema contract, docs, field placement, versioning, and runtime Zod behavior. The one missing integration guard above is the reason this is not approvable yet.

## Bloat / Non-Functional

None.

## Recommendations

- Replace the current "round-trip" case with a real integration test that exercises the same surfaces the directive names: construct a valid row via the writer-side validation path, persist/read a JSONL line through the tailer path, and assert `agent_id` and `agent_id_source` survive unchanged.
- Keep the existing unit cases. They are useful and largely complete; the missing piece is the one higher-level guard the directive explicitly required.

## Bottom Line

The schema change itself is correct: the enum casing is right, the asymmetric invariant is enforced through the real Zod code path, the schema stays on `v: 1`, the comment block and CHANGELOG carry the required rollout/attestation language, the fields are placed correctly, and the package version was not bumped. But the implementation stops short of the directive's required writer/tailer round-trip test and explicitly replaces it with a schema-only loop. Because this is a load-bearing cross-repo contract, that missing integration guard is a blocking review finding.

— Codex review
