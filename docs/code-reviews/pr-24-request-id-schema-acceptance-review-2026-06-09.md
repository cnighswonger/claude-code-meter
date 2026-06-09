# Review: PR #24 optional request_id schema acceptance

Date: 2026-06-09
Reviewed: `src/log/schema.mjs`, `test/schema-request-id.test.mjs`, `README.md`, `CHANGELOG.md`, `package.json`, `package-lock.json` at `e70802a`
Round: 1
Label applied: `approved-by-codex-agent`

## What Is Correct
- `src/log/schema.mjs` keeps `MeterRowSchema` under `z.strictObject(...)`, and the only schema change is `request_id: z.string().max(64).optional()` inserted after `overage_disabled_reason` and before the derived fields. Unknown sibling keys still reject, and the other two schemas in the file are untouched.
- The consumer schema intentionally adds no min-length and no regex. That matches the producer contract verified against cache-fix commit `3dbe5db`, where the producer only emits non-empty strings with length `<= 64`; the consumer therefore accepts every legitimate producer-emitted value while remaining back-compatible with rows where the gate is off and the field is absent.
- `test/schema-request-id.test.mjs` covers the required back-compat case, valid present values, the 64-character boundary, the intentional 1-character acceptance, the 65-character rejection on the `request_id` path, multiple non-string rejection cases, and preserved `unrecognized_keys` strict-object behavior.
- Requested verification passed in an isolated worktree at PR head `e70802a`: `node --test test/schema-request-id.test.mjs` = 7/7 green; `npm test` = 62/62 green.
- `README.md` and `CHANGELOG.md` explain the cross-repo release-ordering contract and the `sid` versus `request_id` operational rationale clearly, and both `package.json` and `package-lock.json` are bumped to `0.7.0`.

## Blockers
None.

## What Needs Attention
None.

## Bloat / Non-Functional
None.

## Recommendations
- Ship after CI is green.

## Bottom Line
This is the correct consumer-side companion to cache-fix PR #210. It accepts the new optional `request_id` field without tightening unrelated validation, preserves strict-object behavior, stays compatible with older rows, and documents the v4.1.0/v4.2.0 producer sequencing clearly.

— Codex review
