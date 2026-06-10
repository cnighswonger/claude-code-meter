# Review: PR #25 claude-fable-5 known rates

Date: 2026-06-10
Reviewed: `src/constants.mjs`, `src/cli/analyze.mjs`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `web/src/components/charts.jsx` at `c5aba49`
Round: 1
Label applied: `approved-by-codex-agent`

## What Is Correct
- `src/constants.mjs:52` inserts only a new `"claude-fable-5"` object immediately after `"claude-haiku-3-5"` and before the closing brace; no other model entries moved or changed.
- The new `standard` tier in `src/constants.mjs:56` matches the supplied pre-release numbers exactly: `input: 10`, `output: 50`, `cache_write_5m: 12.50`, `cache_write_1h: 20`, `cache_read: 1.00`. The cache values correctly derive from the documented multipliers at `src/constants.mjs:21`.
- The entry is a plain object key with no added name validation or regex handling, which matches the analyzer's existing lookup path.
- `src/cli/analyze.mjs:289` normalizes only a trailing date suffix and then reads `KNOWN_RATES[modelKey]?.standard` at `src/cli/analyze.mjs:290`, so a `claude-fable-5` row now flows directly into `cost_analysis.by_model` at `src/cli/analyze.mjs:320`.
- The inline TODO is present at `src/constants.mjs:55` and correctly pins rate re-verification to GA because the current source is an Anthropic pre-release email, not the public pricing page.
- Requested smoke test passed on local data at PR head: `node bin/claude-meter.mjs analyze | jq '.cost_analysis.by_model["claude-fable-5"]'` returned `{ "cost": 199.6672, "calls": 1024 }`, confirming the patch converts the prior silent $0 undercount into a non-zero, plausible value.
- `CHANGELOG.md:5` adds `0.7.1` at the top, documents the prior $0 behavior, cites the Anthropic email dated 2026-06-09 as a pre-release source, records the exact rates, pins the GA re-verification TODO, and correctly scopes the dashboard work as a separate follow-up. That separation is supported by the still-hardcoded dashboard model order in `web/src/components/charts.jsx:239`.
- `package.json:3` and `package-lock.json:3` both bump `0.7.0` to `0.7.1`, which is the correct patch-level release for additive pricing coverage with no schema change and no behavior change for non-Fable models.
- Verification passed at PR head: `npm test` = 62/62 green.

## Blockers
None.

## What Needs Attention
None.

## Bloat / Non-Functional
None.

## Recommendations
- Ship after CI is green.
- Follow up separately on dashboard model ordering so Fable-5 appears in the editorialized per-model chart as well, not just in `cost_analysis.by_model`.

## Bottom Line
This patch does exactly what the release note claims and nothing more. The Fable-5 rates are inserted in the right place with the right math and provenance caveat, the analyzer already consumes the new entry through its existing `standard` rate lookup, local data now prices 1,024 Fable-5 calls at $199.6672 instead of silently reporting $0, and the version bump is appropriate for the scope.

— Codex review
