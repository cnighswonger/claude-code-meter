Codex review:

# Review: dashboard-dynamic-models (PR #27)

Date: 2026-06-10
Reviewed: `docs/directives/dashboard-dynamic-models.md` at `7a02a02`
Round: 2
Verdict: APPROVE
Label applied: `approved-by-codex-agent`

## What Is Correct

- Codex blocker 1 is resolved. The module-split section now names the actual moved-symbol consumers at `src/cli/analyze.mjs:2` and `src/cli/rates.mjs:2`, and test plan #1 now requires referential-equality checks for `KNOWN_RATES`, `RATES_LAST_VERIFIED`, `RATES_SOURCE_URL`, and `PLAN_LIST_PRICE_PER_DAY` imported from both `src/rates.mjs` and `src/constants.mjs` (`docs/directives/dashboard-dynamic-models.md:89-95`, `docs/directives/dashboard-dynamic-models.md:245-254`).
- Codex blocker 2 is resolved. The directive now enumerates the stale visible-label sites in `web/src/components/charts.jsx:277,289`, `web/src/components/sections.jsx:541`, `web/src/components/analysis-charts.jsx:220,224`, and `web/src/components/analysis-sections.jsx:356-358,371`, and it requires those strings to derive from `shortenModel(MODEL_BASELINE)` or `shortenModel(EDITORIAL_COMPARISON_PAIR.{cheaper,expensive})` rather than staying hardcoded (`docs/directives/dashboard-dynamic-models.md:190-216`, `docs/directives/dashboard-dynamic-models.md:290-294`, `docs/directives/dashboard-dynamic-models.md:322`).
- Codex attention 1 is resolved. The Vite `server.fs.allow` boundary check moved to implementation step 1 with a concrete diff sketch, which is the right fail-fast placement for this refactor (`docs/directives/dashboard-dynamic-models.md:271-285`).
- Codex attention 2 is resolved. Test plan #1 now locks down uniqueness of `MODEL_DISPLAY_ORDER` and distinctness of `EDITORIAL_COMPARISON_PAIR` (`docs/directives/dashboard-dynamic-models.md:250-253`, `docs/directives/dashboard-dynamic-models.md:317-318`).
- Codex attention 3 is resolved. The remaining prose now says the misconfiguration is "caught at CI by the unit test," matching the round-3 doc-comment correction (`docs/directives/dashboard-dynamic-models.md:188`).
- The Opus 4.7 advisory carve-out is substantively correct. The cited strings in `web/src/components/sections.jsx:227-228,402,404,412,415,528` and `web/src/components/analysis-sections.jsx:65,397,405,477` are editorial hypothesis content, not configurable baseline/pair labels, so leaving that content hardcoded is consistent with the directive's distinction between story copy and configurable dashboard labels.

## Blockers

None.

## What Needs Attention

1. The literal-name grep carve-out examples are directionally right but not exhaustive. The same advisory story also surfaces hardcoded Opus labels in `web/src/components/charts.jsx:321,346,358,362,382`, so the checklist line at `docs/directives/dashboard-dynamic-models.md:322` should be read as illustrative rather than as a complete list of allowed matches.
2. The directive now tells `analysis-charts.jsx` and `analysis-sections.jsx` to derive labels from `shortenModel(...)`, but `shortenModel` currently lives only in `web/src/components/charts.jsx:317-319`. The behavior target is clear, but helper placement is still an implementation choice the directive does not pin down.

## Bloat / Non-Functional

None.

## Recommendations

- Keep the approval as-is for this round, but when the implementation PR lands, treat the reviewer-checklist carve-out examples as non-exhaustive and verify the advisory-only matches in `charts.jsx` alongside the `sections.jsx` and `analysis-sections.jsx` examples already named in the directive.
- During implementation, centralize `shortenModel` in a shared utility if more than one component needs it, rather than duplicating it across files.

## Bottom Line

This refresh pass resolves the two blockers and three attention items from my round-1 review. The directive now pins the compatibility contract, enumerates the user-visible copy surfaces that actually matter, and moves the Vite pre-flight to the correct place in the execution order. The remaining concerns are checklist-clarity nits, not correctness gaps, so this is ready to proceed.

— Codex review
