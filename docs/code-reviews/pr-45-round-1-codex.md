# Review: PR #45 v0.9.0 release commit

Date: 2026-08-06
Reviewed: PR #45 release commit `7ccfaf7cca260fe8b67cc95b0ace16f68101d77f`
Round: 1
Label applied: `approved-by-codex-agent`

## What Is Correct

The release diff is scoped to the expected three files only: `CHANGELOG.md`, `package.json`, and `package-lock.json`. The package metadata is consistently bumped to `0.9.0` in both `package.json` and the lockfile root package.

The changelog entry accurately reflects the commits since `v0.8.0`:

- `#35` / `a276b3e` lands the Q5h-window regression implementation and its anonymized 90-window fixture.
- `#36` / `63cc0b9` is directive/review artifact churn for the rates-history ledger master directive.
- `#37` / `ec6651c` adds the Phase 1 weight-history ledger, `--refit`, and `--history` behavior.
- `#39` / `aa16120` adds Phase 2 drift detection behavior.
- `#40` / `087ad9f` adds Phase 3 scheduled refit cadence.
- `#41` / `71f0397` is Phase 4 directive/review artifact churn only; no client implementation is present in the v0.9.0 window, matching the changelog's deferred-implementation statement.
- `#42` / `c4e379c` is the usage-row extended-fields directive merge.
- `#44` / `0a9ba92` and `3b7197f` implement `ttl_tier` and `duration_ms` on `MeterRowSchema` with the new schema tests.

The schema claim is correct. `src/log/schema.mjs` keeps `v: z.literal(1)` on `MeterRowSchema`, adds `ttl_tier: z.enum(["5m", "1h"]).optional()`, and adds `duration_ms: z.number().int().min(0).optional()`. The fields are independent; no new pairing invariant is introduced.

The test suite is green after installing dependencies from the lockfile: `npm test` reports 154 passing tests, 0 failures.

The requested public-info hygiene checks on the release diff were empty.

## Blockers

None.

## What Needs Attention

Chris human review is still required before treating this as fully release-approved. The release is load-bearing for the cross-repo cache-fix rollout: cache-fix #320's env-var attestation depends on the v0.9.0 tag existing before `CACHE_FIX_USAGE_LOG_EXTENDED=on` is enabled.

## Bloat / Non-Functional

None. The release commit itself is small and mechanical: changelog plus package version bumps only.

## Recommendations

Tag v0.9.0 only after Chris's human review/approval lands, then unblock the cache-fix #320 release chain.

## Bottom Line

Approve. The v0.9.0 release commit matches the shipped commits since v0.8.0, preserves the additive `v: 1` schema invariant, keeps the release diff scoped to the expected files, and passes the full test suite.
