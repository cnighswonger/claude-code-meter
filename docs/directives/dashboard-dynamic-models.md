# Directive: drive dashboard model list from `KNOWN_RATES` dynamically

**Issue:** #26
**Branch:** `feature/dashboard-dynamic-models`
**Stage:** directive
**Milestone:** v0.8.0 (minor — additive constants surface, dashboard refactor; data shape unchanged)

## Goal

Eliminate the 4-model hardcoded list (`opus-4-6`, `opus-4-7`, `haiku-4-5`, `sonnet-4-6`) embedded across the four `web/src/components/*.jsx` files so that adding a model to `KNOWN_RATES` automatically appears in every dashboard chart and per-model comparison surface. Fable-5 is the immediate forcing function (v0.7.1 added it to `KNOWN_RATES` and the analyzer correctly prices it, but the chart never renders it), and every future Anthropic model will hit the same silent-absent failure mode.

## Why

11 references across 4 files (enumerated via grep on PR #25 review):

- `web/src/components/charts.jsx:239` — `const labelOrder = ["claude-haiku-4-5", "claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-7"];` (by-model cost chart hard cap)
- `web/src/components/charts.jsx:244` — `metrics.modelCostPerTurn["claude-opus-4-6"]` (baseline reference)
- `web/src/components/sections.jsx:389-390, 515-516, 546-547` — opus-4-6, opus-4-7, haiku-4-5 by literal key for cost-per-turn comparison cards
- `web/src/components/analysis-charts.jsx:215-216` — opus-4-7 + haiku-4-5 for the analysis-page chart
- `web/src/components/analysis-sections.jsx:339-340, 388-389` — same for the analysis-page comparison cards

The pattern is: each chart component imports rendering data via prop, reaches into the data object by literal model-name key, formats it, and renders. Adding a new model to `KNOWN_RATES` flows data through to the API but the chart component never reads it because the literal key isn't in the list.

This is a recurring failure mode every model release. The fix is to drive the list of models the dashboard knows about from the same source of truth the analyzer uses — `KNOWN_RATES`.

## Non-Functional Requirements

- **Size/complexity budget:** ~150-250 LOC across 5 files (`src/constants.mjs` adds display ordering + baseline, 4 chart components consume it). The 4 chart files total 2.6K LOC; this changes ~10% of each file's model-resolution code paths. Flag at review if the diff materially exceeds that.
- **Threat model:** the dashboard is a public-facing surface but read-only and serves only aggregated community data. The refactor touches NO server endpoints, NO schemas, NO submission code. No new secret-handling surface. The chart components run client-side and import `KNOWN_RATES` keys (not rates); no rate data leaks beyond what's already exposed in CHANGELOG / source.
- **Maintainability constraints:** prefer driving the model list from existing `KNOWN_RATES` rather than introducing a parallel constant. Avoid hardcoding a baseline (`opus-4-6`) anywhere — express the baseline-choice intent in the constants surface so future model adds can re-baseline without a chart rewrite. No new abstraction unless 2+ components consume it; otherwise inline the helper near the call site.
- **Performance/reliability:** chart renders are client-side, no server impact. The model list is small (~7-10 entries even with growth) so any `Object.keys()` / `Object.entries()` iteration is O(n) trivial.
- **Load-bearing? yes** — the community dashboard is the public-visible surface of the project, and a refactor that breaks chart rendering would be a user-visible regression on the day it ships. Visual-regression testing (eyeball the live page against the current screenshots) is required before merge. The refactor is mechanical, not semantic, but the load-bearing classification keeps the bar at "must verify in browser before merge", not "tests pass and call it done."

## Schema additions to `src/constants.mjs`

Add two constants alongside the existing `KNOWN_RATES`:

```js
// Display order for the by-model cost chart and per-model comparison
// cards. The dashboard reads this list in declared order to populate
// chart series and editorial cards. Entries MUST be keys present in
// KNOWN_RATES, but KNOWN_RATES may contain models not listed here
// (the chart hides any KNOWN_RATES entry not in MODEL_DISPLAY_ORDER —
// useful for deprecated or rarely-seen models where the dashboard
// would only add noise).
//
// Order: cheap → expensive, matching the editorial convention from
// v0.6.x. New model additions go at the position that preserves the
// cheap-to-expensive sort.
export const MODEL_DISPLAY_ORDER = [
  "claude-haiku-4-5",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-fable-5",
  "claude-opus-4-7",
];

// The "baseline" model for cost-per-turn comparison cards (e.g.,
// "haiku-4-5 is ~10× cheaper than opus-4-7"). The chart components
// pick this model's cost-per-turn as the reference value for the
// "X% vs baseline" annotations on each bar. Change this when the
// editorial story shifts (e.g., when opus-4-6 is sunset, move the
// baseline to opus-4-7 or the most-used model in the dataset).
//
// MUST be a key present in MODEL_DISPLAY_ORDER (and therefore in
// KNOWN_RATES). The chart components fail-soft to the first entry
// in MODEL_DISPLAY_ORDER if this is misconfigured.
export const MODEL_BASELINE = "claude-opus-4-6";
```

The two constants together replace every hardcoded model list and baseline reference in the chart components. Anyone adding a new model to `KNOWN_RATES` only needs to insert it into `MODEL_DISPLAY_ORDER` at the right position; the chart components pick it up on next render.

## Chart-component refactor (the 11 references)

### `web/src/components/charts.jsx`

```diff
- const labelOrder = ["claude-haiku-4-5", "claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-7"];
- const colors = ["val", "info", "warn", "bad"];
+ import { MODEL_DISPLAY_ORDER, MODEL_BASELINE } from "../../../src/constants.mjs";
+ // Pick the project's tier-color sequence by index. If MODEL_DISPLAY_ORDER
+ // grows past 4, recycle the last color rather than crashing — the editorial
+ // chart isn't meaningful past 4-5 categories anyway.
+ const colors = ["val", "info", "warn", "bad", "neutral"];
  const data = labelOrder
-   .map((m, i) => ({ name: shortenModel(m), y: metrics.modelCostPerTurn[m] || 0, kind: colors[i] }))
+   .map((m, i) => ({ name: shortenModel(m), y: metrics.modelCostPerTurn[m] || 0, kind: colors[Math.min(i, colors.length - 1)] }))
    .filter((d) => d.y > 0);
- const baseline = metrics.modelCostPerTurn["claude-opus-4-6"] || 0;
+ const baseline = metrics.modelCostPerTurn[MODEL_BASELINE] || metrics.modelCostPerTurn[MODEL_DISPLAY_ORDER[0]] || 0;
```

### `web/src/components/sections.jsx` (lines 389-390, 515-516, 546-547)

Replace the literal-key access with a helper:

```js
function getModelMetric(metrics, modelKey, field) {
  if (field === "avg_q5h_per_turn") {
    return metrics.modelSplits[modelKey]?.avg_q5h_per_turn || 0;
  }
  return metrics[field]?.[modelKey] || 0;
}
```

Then update the comparison-card editorial blocks to use the helper. The "haiku-4-5 is X× cheaper than opus-4-7" card is editorial content — it stays semantically the same (still names haiku and opus-4-7), but the cost-lookup goes through the helper so future model adds can swap the comparison pair via a constant without touching the editorial text. (Alternative: convert the editorial pair to "cheapest in dataset vs most-used in dataset" — more dynamic but loses the editorial pinning. Operator's call; this directive recommends keeping the editorial pinning for now.)

### `web/src/components/analysis-charts.jsx` (lines 215-216)

Same pattern — replace literal-key access with `MODEL_DISPLAY_ORDER`-driven loop where the chart renders multiple models, or with the helper where the call is editorial.

### `web/src/components/analysis-sections.jsx` (lines 339-340, 388-389)

Same pattern.

## Acceptance criteria

- Adding `claude-fable-5` to `KNOWN_RATES` (which v0.7.1 did) AND inserting it into `MODEL_DISPLAY_ORDER` (this directive's PR does that) causes Fable to appear in the by-model cost chart, the model-split chart, and any per-model surfaces — automatically, no chart-component code change.
- Adding a hypothetical `claude-sonnet-4-7` to `KNOWN_RATES` + `MODEL_DISPLAY_ORDER` works the same way.
- Removing a model from `MODEL_DISPLAY_ORDER` (leaving it in `KNOWN_RATES`) hides it from the dashboard but the analyzer still prices it.
- The chart ordering stays cheap-to-expensive for the existing 4 models (visual regression cost = 0 vs. current screenshots).
- The "baseline" reference (currently opus-4-6) is preserved in the editorial cards; changing `MODEL_BASELINE` swaps the baseline.

## Test plan

1. **Unit:** the two new constants export the expected shape; `MODEL_DISPLAY_ORDER` is a non-empty array of strings; `MODEL_BASELINE` is a non-empty string; every entry in `MODEL_DISPLAY_ORDER` is a key in `KNOWN_RATES`; `MODEL_BASELINE` is a key in `KNOWN_RATES`.
2. **Visual:** run the dashboard locally (`npm run dev` in `web/`) against the deployed `/api/v1/stats` data. Verify Fable-5 appears in the by-model cost chart at its declared position in `MODEL_DISPLAY_ORDER`. Capture before/after screenshots for the PR. Eyeball the existing 4-model chart for visual regression.
3. **Integration on droplet:** after merge + deploy, fetch `https://meter.vsits.co/` and confirm the chart includes Fable-5.

## Out of scope (explicit)

- **Server-side changes.** `/api/v1/stats` already returns every model in the data regardless of dashboard rendering. No server endpoint change needed.
- **Analyzer changes.** `cost_analysis.by_model` already includes every `KNOWN_RATES` entry (since v0.7.1).
- **Schema changes.** `MeterRowSchema v:1` and `SharePayloadSchema v:1` don't move.
- **Backfill of historical Fable submissions.** Past submissions already have Fable in their `model_splits` — no schema reshape required.
- **Comparison-card editorial pair changes.** The "haiku-4-5 is X× cheaper than opus-4-7" framing stays; the lookup path becomes dynamic but the editorial pair is hardcoded. Refactor to "dynamic-pair (cheapest vs most-used)" is a separate editorial question outside this directive's scope.
- **Dynamic baseline auto-selection.** The directive keeps `MODEL_BASELINE` as an explicit constant rather than computing "the model with the most calls in the current dataset." Auto-baseline would be more dynamic but changes the editorial story per-window — out of scope; revisit when an actual operator pain point materializes.

## Implementation order (single PR)

1. Add `MODEL_DISPLAY_ORDER` + `MODEL_BASELINE` constants to `src/constants.mjs` with the inline documentation above.
2. Refactor `web/src/components/charts.jsx` to consume the constants.
3. Refactor the other 3 chart components to consume the constants.
4. Add the unit tests in `test/constants-model-display.test.mjs` (or extend an existing test file if there's a natural home).
5. Visual regression check: run `npm run dev` + screenshots for PR.
6. CHANGELOG entry under `## [Unreleased]` documenting the new constants surface, the dashboard refactor, and Fable-5's appearance on the chart.

## Files modified / created

- `src/constants.mjs` — add `MODEL_DISPLAY_ORDER` + `MODEL_BASELINE`
- `web/src/components/charts.jsx`
- `web/src/components/sections.jsx`
- `web/src/components/analysis-charts.jsx`
- `web/src/components/analysis-sections.jsx`
- `test/constants-model-display.test.mjs` (new)
- `CHANGELOG.md` — Unreleased entry for v0.8.0

## Reviewer checklist

- [ ] `MODEL_DISPLAY_ORDER` and `MODEL_BASELINE` are exported from `src/constants.mjs` with the inline docs explaining their role.
- [ ] Every entry in `MODEL_DISPLAY_ORDER` is a key in `KNOWN_RATES`; `MODEL_BASELINE` is a key in `KNOWN_RATES`.
- [ ] All four chart components import from `../../../src/constants.mjs` (or whatever the chart→constants path resolves to) — no parallel constant.
- [ ] No remaining literal-key model accesses in `web/src/components/*.jsx`.
- [ ] Color sequence handles `MODEL_DISPLAY_ORDER` growth past 4 (recycles or extends; doesn't crash on index-out-of-bounds).
- [ ] Visual regression: existing 4-model chart looks identical to pre-refactor; Fable-5 appears at the declared position.
- [ ] Unit tests pass.
- [ ] CHANGELOG entry calls out the new constants surface AND the dashboard rendering of Fable-5.
