# Review: PR #48 analyze Math.max spread crash fix

Date: 2026-08-06
Reviewed: `src/cli/analyze.mjs` at `80a785d501fe9cadf60976d65a28bd123856fca2`
Round: 1
Label applied: `approved-by-codex-agent`

## What Is Correct

The change is correctly scoped as a leaf bug fix. PR #48 removes only the two dead locals in `detectPlanTier(rows)` plus the now-misleading comment above them:

```diff
-  // If any row has high q5h values, likely Max
-  const maxQ5h = Math.max(...rows.map((r) => r.q5h || 0));
-  const fallback = rows.find((r) => r.qfallback_pct != null)?.qfallback_pct;
```

`detectPlanTier(rows)` still has the same signature and still returns `"unknown"` unconditionally. The call site in `src/cli/analyze.mjs` reads only that return value:

```js
const planTier = args.plan || detectPlanTier(rows);
```

The deleted `maxQ5h` local is no longer referenced anywhere in `src/` or `test/`. The deleted `fallback` local has no remaining function-scope consumer; the only relevant `analyze.mjs` fallback value after the patch is the separate live `fallbackPct` at `src/cli/analyze.mjs:577`, used later in the output payload.

The spread bug is real. On this runtime, `Math.max(...Array.from({ length: 150000 }))` throws `RangeError: Maximum call stack size exceeded`; the exact threshold varies, but the failure class is V8's argument-list limit. The current public stats endpoint still corroborates the production symptom: `https://meter.vsits.co/api/v1/stats` reports `"latest": "2026-06-20T06:37:02.700Z"`.

The class audit is clean after this patch:

```text
$ grep -rnE 'Math\.(max|min)\(\.\.\.' src/ test/
```

No matches remain.

The PR body's sequencing claim is accurate. `v0.9.0` was published on 2026-08-06 at `20:01:46Z`, and issue #46 explicitly scopes deploy/update work after this fix so the droplet does not move to a release that still contains the crash. I found no cross-repo dependency in the code change: it is a single-file local CLI deletion, with deployment/release sequencing handled outside the repo diff.

Verification:

- `git diff origin/main...HEAD -- src/cli/analyze.mjs` shows exactly three deleted lines in one file.
- `grep -rn maxQ5h src/ test/` returns no matches.
- `grep -rnE 'Math\.(max|min)\(\.\.\.' src/ test/` returns no matches.
- `npm test` passes 154/154, matching the expected v0.9.0 test count.

## Blockers

None.

## What Needs Attention

None.

## Bloat / Non-Functional

None. This is the right anti-bloat shape: delete the dead, crashing computation instead of rewriting it into a safer loop with no consumer. I do not recommend adding a test for an unexported helper whose observable contract remains a constant `"unknown"` return.

## Recommendations

Merge this PR before cutting and deploying a v0.9.1 patch release. Real plan-tier detection, if wanted, should stay a separate feature/design decision.

## Bottom Line

Approve. The deleted locals are unused, the function contract is unchanged, the size-triggered `Math.max(...rows)` crash is removed, and no same-class `Math.max`/`Math.min` spread pattern remains in `src/` or `test/`.

-- Codex review
