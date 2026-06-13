Codex review:

# Review: release v0.8.0 (PR #32)

Date: 2026-06-13
Reviewed: PR #32 at `6d1e2699b03e80932deaaba87d4d06ae05dfae9a`
Round: 1
Verdict: APPROVE
Label applied: approved-by-codex-agent

## What Is Correct

- `git log v0.7.1..HEAD --oneline` shows two shipped feature tracks after `v0.7.1`: the dashboard dynamic-models work (PR #29, including the unshipped fixup at `5aea3dd`) and the additive `agent_id` / `agent_id_source` schema work (PR #31). The `## [0.8.0] - 2026-06-13` section in `CHANGELOG.md` covers both release-worthy changes, and the small `5aea3dd` fix is correctly subsumed under the dashboard entry rather than omitted as a separate shipped feature.
- The release diff at `6d1e269` is scoped exactly to `CHANGELOG.md`, `package.json`, and `package-lock.json`. `CHANGELOG.md` performs the expected heading rollover (`## [Unreleased]` preserved above the new `## [0.8.0] - 2026-06-13` section) and corrects the schema test count from 21 to 23 to match the final merged test surface.
- The version bump from `0.7.1` to `0.8.0` is the correct SemVer scope. PR #29 adds a new pure-data module plus additive dashboard rendering behavior for models already present in rates data; PR #31 adds optional schema fields with back-compat preserved and schema version held at `v: 1`. That is additive, backward-compatible change, so minor is correct; patch would understate scope and major would overstate it.
- `package.json` and `package-lock.json` both resolve to `name: "claude-code-meter"` and `version: "0.8.0"`. The lockfile’s added `funding` block and package-name normalization match the package manifest and read as standard `npm` regeneration output, not stray local patch content.
- The release branch worktree is clean at review time (`release/v0.8.0` at `6d1e2699b03e80932deaaba87d4d06ae05dfae9a`), so there is no uncommitted state attached to the commit under review.
- Hygiene checks on the release diff found no debug code, no secret-like material, no literal IPv4 addresses, no SSH targets, and no internal hostnames. The only hostname-bearing addition is the public `https://buymeacoffee.com/vsits` funding URL in `package-lock.json`.
- Verification is consistent with the release note: `npm test` passes on the release branch with `98` tests passing and `0` failures.

## Blockers

None.

## What Needs Attention

None.

## Bloat / Non-Functional

None.

## Recommendations

- Proceed with the release gate. No additional release-note or versioning corrections are needed on this commit.

## Bottom Line

This release commit is correctly scoped and accurately documented. The `v0.7.1..HEAD` history contains the two intended backward-compatible feature tracks, the `0.8.0` CHANGELOG entry accounts for them, the minor bump is the right SemVer choice, the diff contains only the expected release files, and the branch still tests clean at `98/98`. This is ready to approve.

— Codex review
