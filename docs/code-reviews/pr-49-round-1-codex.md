# Review: PR #49 v0.9.1 Patch Release

Date: 2026-08-06
Reviewed: PR #49 (`release/v0.9.1`) at `2deda0f2d5983b6f10e0a42551c5e2a654c278b2`
Round: 1
Label applied: approved-by-codex-agent, reviewed-by-codex-agent

## What Is Correct

The PR diff against `main` is limited to the expected release-mechanical files: `CHANGELOG.md`, `package.json`, and `package-lock.json`. The package version moved from `0.9.0` to `0.9.1` in both package manifests, with no unrelated source, test, or generated-file changes in the PR.

The changelog entry accurately describes the #46 crash and #48 fix. The actual fix since `v0.9.0` is the deletion of two dead `detectPlanTier` lines in `src/cli/analyze.mjs`: the discarded `Math.max(...rows.map(...))` computation and the unused `fallback` lookup. Because `detectPlanTier` still unconditionally returns `"unknown"`, the changelog is correct that deleting the dead computation fixes the argument-spread crash without changing plan-tier behavior.

The `git log v0.9.0..2deda0f --oneline` range contains the #48 merge and its branch commits, including the prior review artifact commit:

```text
2deda0f release: v0.9.1
b1b3664 Merge pull request #48 from cnighswonger/fix/analyze-math-max-spread-crash
f56074b review: PR #48 analyze spread crash fix
80a785d fix(analyze): delete dead Math.max(...rows) spread crashing past ~100k rows
```

That range is consistent with a fast-follow release over the #48 crash fix. The changelog names issue #46 and fix PR #48 correctly.

The requested info-hygiene grep over the PR diff returned no matches for the forbidden IP, privileged-SSH, internal-hostname, or operator-home patterns. The release note uses generic host language for the affected machine and does not repeat the hostname leak from the earlier #48 commit body.

The `v: 1` schema invariant is preserved. `git diff --exit-code v0.9.0..2deda0f -- src/log/schema.mjs` is clean, so `src/log/schema.mjs` matches `v0.9.0` byte-for-byte.

Verification passed:

```text
npm test
tests 154
pass 154
fail 0
```

Clean-worktree package audits also match the expected release shape:

```text
npm pack --dry-run at 2deda0f: total files 27, package size 60.5 kB
npm pack --dry-run at v0.9.0: total files 27, package size 60.5 kB
```

## Blockers

None.

## What Needs Attention

None.

## Bloat / Non-Functional

None. This remains a leaf patch release: one changelog entry plus the package and lockfile version bump. It does not expand the bug-fix scope or introduce schema/package surface changes.

## Recommendations

Proceed with Chris's required human review before merge, since this release is mildly load-bearing for the meter droplet deployment and cache-fix #320 operator attestation.

## Bottom Line

Approve. PR #49 is a clean v0.9.1 patch release over the #48 crash fix: version bump scope is correct, the changelog matches the actual fix, tests pass, the package contents match v0.9.0's expected shape, no requested info-hygiene patterns are present, and the schema is unchanged from `v0.9.0`.

— Codex review
