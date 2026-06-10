Codex review:

# Review: dashboard-dynamic-models implementation (PR #29)

Date: 2026-06-10
Reviewed: PR #29 at `5aea3dd0d29646a72438a7f9096d44305bf1fc05`
Round: 2
Verdict: APPROVE
Label applied: approved-by-codex-agent

## What Is Correct

- `web/src/components/analysis-charts.jsx:224-245` consistently uses the renamed substitution locals `expensiveCost` and `cheaperCost`, including the `deps={[expensiveCost, cheaperCost]}` array that was broken in round 1.
- `web/src/components/analysis-charts.jsx:268-272` now computes tooltip percentage math from `expensiveCost` and derives the baseline copy from `expensiveLabel` via ``all-${expensiveLabel}``, removing the stale `opus47` reference and the hardcoded `all-Opus` string.
- The substitution endpoint labels remain internally consistent: `web/src/components/analysis-charts.jsx:231-235` uses `expensiveLabel` for the 0% endpoint and `cheaperLabel` for the 25/50/75/100% substitution labels.
- `grep -nE "opus47|haiku" web/src/components/analysis-charts.jsx` returns no matches, so the stale local names are fully removed from the component.
- The code change from `1dbe6ed` to `5aea3dd` is scoped to the three blocker lines in `web/src/components/analysis-charts.jsx`; no unrelated implementation scope was added beyond the round-1 review artifact already committed in the branch.

## Blockers

None.

## What Needs Attention

- The runtime UI smoke check previously recommended for the deep-analysis substitution surface is still a sensible follow-up, but it is not a new blocker for this bounded re-review.

## Bloat / Non-Functional

None.

## Recommendations

- Keep the planned follow-up for lightweight UI/runtime coverage in `web/` so similar refactor regressions are easier to catch before review.

## Bottom Line

The round-1 blocker is fixed. `SubstitutionChart` no longer references deleted `opus47` / `haiku` locals, the dependency array and tooltip math now use the renamed cost variables, the tooltip copy is derived from the configured expensive model label, and the substitution endpoint labels remain consistent. I did not find new issues in the scoped fix, so this is ready to approve.

— Codex review
