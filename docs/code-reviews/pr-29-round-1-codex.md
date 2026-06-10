Codex review:

# Review: dashboard-dynamic-models implementation (PR #29)

Date: 2026-06-10
Reviewed: PR #29 at `1dbe6ed66ec38972b8a18eff7a673191840d25fa`
Round: 1
Verdict: REQUEST_CHANGES
Label applied: None (`changes-requested` label is not present in this repo)

## What Is Correct

- `src/rates.mjs` satisfies the browser-safe split the directive required: it has no `node:*` imports, it carries the moved pricing data plus `MODEL_DISPLAY_ORDER`, `MODEL_BASELINE`, and `EDITORIAL_COMPARISON_PAIR`, and its comments preserve the cheap-to-expensive ordering rule plus the zero-data baseline fail-soft behavior.
- `src/constants.mjs` is correctly slimmed to the Node-only surface, and the re-export contract for `KNOWN_RATES`, `RATES_LAST_VERIFIED`, `RATES_SOURCE_URL`, and `PLAN_LIST_PRICE_PER_DAY` is present. I compared the old exported surface from `main` to the current one and found no missing consumer-facing names.
- The current `constants.mjs` consumers still match the intended split: `src/cli/analyze.mjs:2` and `src/cli/rates.mjs:2` use the moved symbols through the shim, while `src/consent.mjs:16`, `src/share/client.mjs:2`, `src/interceptor/fetch-patch.mjs:15`, `src/cli/setup.mjs:4`, `src/log/reader.mjs:2`, `src/log/writer.mjs:3`, and `src/cli/ingest.mjs:13` still import Node-only symbols that remain in `src/constants.mjs`.
- The four web components import from `../../../src/rates.mjs` and `../lib/model-metrics.mjs` as directed. The baseline label in `web/src/components/charts.jsx` and the comparison-pair copy in `web/src/components/sections.jsx` / `web/src/components/analysis-sections.jsx` were mostly updated the way the directive asked.
- `test/rates-display.test.mjs` covers the intended 13 cases: display-order membership/uniqueness, baseline invariants, editorial-pair invariants, the re-export contract, and the browser-safe `src/rates.mjs` constraint.
- `web/vite.config.mjs:37-45` includes the required `server.fs.allow: [".."]` entry.
- Verification passed on the non-UI surfaces: `npm test` passes, and `cd web && npm run build` passes.

## Blockers

### 1. `SubstitutionChart` still contains stale `opus47` / `haiku` references, so the deep-analysis substitution section is broken at runtime

The refactor renamed the substitution inputs to `expensiveCost` and `cheaperCost` at `web/src/components/analysis-charts.jsx:224-225`, but two live call sites still reference the deleted local names:

- `web/src/components/analysis-charts.jsx:245` sets `deps={[opus47, haiku]}`
- `web/src/components/analysis-charts.jsx:270-272` still computes tooltip text from `opus47` and hardcodes `all-Opus`

Those identifiers are no longer defined anywhere in the component. This is not just stale copy; it is a real runtime fault. As soon as `SubstitutionChart` executes on a dataset where the section should render, evaluating `deps={[opus47, haiku]}` throws a `ReferenceError` before the chart can mount. The tooltip path is also still half-refactored even if the render-time crash is fixed first.

This escaped because the new unit tests only cover the constants/re-export contract, and `vite build` does not execute the React component body. But the directive was explicit that the deep-analysis substitution surface had to move to the shared helper + editorial-pair constants, and this component is not complete yet.

What to change:
- Replace the stale `deps` array with the renamed values.
- Replace the tooltip baseline math and copy so it derives from the configured expensive endpoint rather than the deleted `opus47` local and the hardcoded `all-Opus` string.
- Re-check the deep-analysis page in-browser after the fix; this is exactly the kind of runtime-only regression the directive's visual-regression step was meant to catch.

## What Needs Attention

- No additional blocking correctness issues stood out after the module split / re-export / Vite checks. The remaining hardcoded Opus advisory copy in `web/src/components/charts.jsx`, `web/src/components/sections.jsx`, and `web/src/components/analysis-sections.jsx` matches the directive's content-vs-configurable carve-out.

## Bloat / Non-Functional

None.

## Recommendations

- After fixing `SubstitutionChart`, add at least one lightweight UI smoke check for the deep-analysis substitution surface. The current test plan is strong on the constants contract but does not exercise the runtime path where this regression lives.
- Keep the current split as-is otherwise. The `src/rates.mjs` / `src/constants.mjs` boundary, helper placement, and CHANGELOG coverage all line up with the approved directive.

## Bottom Line

The implementation mostly follows the approved directive: the module split is correct, the constant surface is right, the Node shim still preserves existing consumers, the four components were moved onto the new helper/constants pattern, the new tests are present, and the Vite boundary widening is in place. But the deep-analysis substitution chart was only partially refactored and still references deleted local variables in live code. That leaves one user-visible runtime regression on a load-bearing page, so this is not ready to approve yet.

— Codex review
