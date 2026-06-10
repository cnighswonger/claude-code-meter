# Directive: drive dashboard model list from a pure-data constants module

**Issue:** #26
**Branch:** `feature/dashboard-dynamic-models`
**Stage:** directive (round 4 — addresses Codex round-1 REQUEST_CHANGES following Fable rounds 1-2 in [PR #28](https://github.com/cnighswonger/claude-code-meter/pull/28))
**Milestone:** v0.8.0 (minor — additive constants surface, dashboard refactor; data shape unchanged)

## Round-2 changes (from Fable round-1 review artifact in PR #28)

1. **Blocker fix:** display constants and `KNOWN_RATES` move to a new pure-data module `src/rates.mjs` (no `node:` imports). `src/constants.mjs` re-exports for existing consumers; the chart components import from `../../../src/rates.mjs`. Resolves the Vite-build break the round-1 directive introduced.
2. **Blocker fix:** `MODEL_DISPLAY_ORDER` example value places `claude-fable-5` LAST (after `claude-opus-4-7`) because Fable is the most-expensive model in the rate card. Ordering criterion explicitly stated as "observed median cost-per-turn from the most recent submitted analysis, with the rate card as tiebreaker for new models with no observed data."
3. **Editorial pair constant added:** `EDITORIAL_COMPARISON_PAIR` makes the "haiku vs opus-4-7" cost story a constant rather than three contradicting statements.
4. **Baseline split into hard fail-fast and soft zero-data fallback:** misconfiguration (baseline not in `MODEL_DISPLAY_ORDER`) is a build/test failure; valid baseline with zero data in the current window is an editorial flag the chart shows, not a silent re-baseline.
5. **Color recycling cleaned up:** drop the phantom `"neutral"` token. The existing 4-color sequence (`val/info/warn/bad`) is preserved; any 5th+ model recycles by `i % colors.length`, NOT by adding a non-existent color token.
6. **Helper home declared:** `getModelMetric` (and any other 2+-consumer helper) lives in `web/src/lib/model-metrics.mjs`.
7. **Precision: "17 literals across 14 lines"** (was "11 references" in round 1).
8. **Precision: "model-split chart" reference removed** from acceptance criteria — `modelSplits` is only read by section comparison cards, not a chart surface.
9. **Visual regression: before-screenshot capture step explicit** in the implementation reviewer checklist.

## Round-3 nits (from Fable round-2 APPROVE_WITH_NITS)

10. **Fable-less window case** in the visual regression test plan: the chart's `.filter((d) => d.y > 0)` hides zero-data models, so if the production window happens to have no Fable submissions, the eyeball check is vacuous. Test plan #2 now requires the implementation-PR author to verify Fable rendering using a synthesized stats payload when the production window lacks Fable rows.
11. **"~10% of each file's model-resolution code paths" deleted** from the NFR size budget — Fable correctly observed this was unmeasurable at review time. The 150-250 LOC budget plus "flag at review if the diff materially exceeds that" is the enforceable part.
12. **"PR #27" / "PR #28" framing reconciled** in the Stage line and the Round-2 changes heading — both now say "PR #28" (the artifact lives there as the durable record).
13. **`MODEL_BASELINE` doc comment wording corrected** — "asserts at module load" → "asserts at CI" (tests assert at CI time, not module load).

## Round-4 changes (from Codex round-1 REQUEST_CHANGES — see `docs/code-reviews/pr-27-round-1-codex.md`)

Codex's first review (chain order: Fable → Codex) caught two blockers + three attention items at the polish/correctness layer Fable's architectural sweep did not address.

14. **Re-export contract test added (Codex blocker 1).** The directive's promise that `src/constants.mjs` re-exports preserve Node consumers was only enforced by a "verify the re-export statement exists" reviewer-checklist item — an implementation could satisfy every unit-test assertion, keep `src/rates.mjs` internally correct, and still break the shipped `src/constants.mjs` surface by omitting or misspelling a re-export. Test plan #1 now includes a re-export contract assertion that imports `KNOWN_RATES`, `RATES_LAST_VERIFIED`, `RATES_SOURCE_URL`, and `PLAN_LIST_PRICE_PER_DAY` from BOTH `src/rates.mjs` AND `src/constants.mjs` and asserts referential equality. Also: the hand-wavy consumer inventory ("`src/cli/`, `src/log/`, `src/share/`, `src/ingest/`, `server/`") is replaced with the actual moved-symbol call sites Codex enumerated: `src/cli/analyze.mjs:2` (full list) and `src/cli/rates.mjs:2` (just `KNOWN_RATES`). Other `constants.mjs` consumers (`src/consent.mjs`, `src/cli/ingest.mjs`, `src/log/reader.mjs`, `src/log/writer.mjs`, `src/share/client.mjs`, `src/interceptor/fetch-patch.mjs`, `src/cli/setup.mjs`) import `LOG_FILE`/`CONFIG_FILE`/`MESSAGES_ENDPOINT`/`PROXY_LOG_FILE`/`INGEST_OFFSET_FILE`/`HEADERS`/`SCHEMA_VERSION` — all of which stay in `constants.mjs` (Node-only path setup) and are NOT affected by the split.

15. **User-visible copy enumerated (Codex blocker 2).** The directive promised "changing the baseline updates the story" but the refactor section only enumerated data-lookup sites. Codex listed the stale-label sites that an implementation could legitimately miss while still passing the directive's checklist:
    - `web/src/components/charts.jsx:277` — `vs opus-4-6` label
    - `web/src/components/charts.jsx:289` — `opus-4-6 baseline` label
    - `web/src/components/sections.jsx:541` — `Bars annotated against the opus-4-6 baseline` copy
    - `web/src/components/analysis-charts.jsx:220,224` — `All Opus 4.7` / `All Haiku 4.5` substitution endpoint labels
    - `web/src/components/analysis-sections.jsx:356-358,371` — `Haiku 4.5` / `Opus 4.7` substitution copy + meta label

    The refactor section now requires these labels derive from `shortenModel(MODEL_BASELINE)` and `shortenModel(EDITORIAL_COMPARISON_PAIR.cheaper/.expensive)` so changing the constants updates both the math AND the user-visible story. The reviewer checklist adds an explicit grep verification for residual literal-name labels.

16. **Vite `server.fs.allow` pre-flight moved to step 1 (Codex attention 1).** The implementation-order step was at #7; a faithful implementation would hit the boundary failure mid-refactor and have to back up. Step 1 is now the boundary check with a concrete config sketch: add `server.fs.allow: ['..']` to `web/vite.config.mjs` (relative to `web/` puts the repo root in scope). Production build (Rollup) follows filesystem paths fine; this is dev-only.

17. **Uniqueness invariants added to test plan (Codex attention 2).** Duplicate entries in `MODEL_DISPLAY_ORDER` would pass the round-3 test plan; `EDITORIAL_COMPARISON_PAIR.cheaper === .expensive` would also pass. Both would yield a visibly wrong dashboard while satisfying the existing six assertions. Test plan #1 now asserts: `MODEL_DISPLAY_ORDER` has no duplicate entries (`new Set(MODEL_DISPLAY_ORDER).size === MODEL_DISPLAY_ORDER.length`), and `EDITORIAL_COMPARISON_PAIR.cheaper !== .expensive`.

18. **Wording bug fixed (Codex attention 3).** Line 163 still said "caught at module load via the unit test" — the round-3 doc-comment fix moved this to CI-time but the prose below the diff was missed. Now reads "caught at CI by the unit test."

## Goal

Eliminate the hardcoded model list and `claude-opus-4-6` baseline references currently embedded across the four `web/src/components/*.jsx` files so that adding a model to `KNOWN_RATES` + `MODEL_DISPLAY_ORDER` automatically appears in every dashboard chart and per-model comparison surface. Fable-5 is the immediate forcing function — v0.7.1 added it to `KNOWN_RATES` so the analyzer prices it correctly, but the dashboard never renders it. Every future Anthropic model will hit the same silent-absent failure mode unless the model list becomes data, not hardcode.

## The 17 literals to remove

Enumerated against `origin/main` at the time of writing (verified by Fable's round-1 grep, corrected from the directive's earlier "11"):

- `web/src/components/charts.jsx:239` — `labelOrder` array (4 literals)
- `web/src/components/charts.jsx:244` — `metrics.modelCostPerTurn["claude-opus-4-6"]` (1 literal)
- `web/src/components/sections.jsx:389-390` — `modelSplits["claude-opus-4-6"]`, `modelSplits["claude-opus-4-7"]` (2 literals)
- `web/src/components/sections.jsx:515-516` — `modelCostPerTurn["claude-opus-4-6"]`, `modelCostPerTurn["claude-opus-4-7"]` (2 literals)
- `web/src/components/sections.jsx:546-547` — `modelCostPerTurn["claude-haiku-4-5"]` (2 literals; in the editorial-pair comparison)
- `web/src/components/analysis-charts.jsx:215-216` — `modelCostPerTurn["claude-opus-4-7"]`, `modelCostPerTurn["claude-haiku-4-5"]` (2 literals)
- `web/src/components/analysis-sections.jsx:339-340` — `modelCostPerTurn["claude-opus-4-7"]`, `modelCostPerTurn["claude-haiku-4-5"]` (2 literals)
- `web/src/components/analysis-sections.jsx:388-389` — `modelSplits["claude-opus-4-6"]`, `modelSplits["claude-opus-4-7"]` (2 literals)

Total: **17 literals across 14 lines in 4 files.** The editorial-pair literals (the haiku-vs-opus-4-7 comparisons in `sections.jsx:546-547` and `analysis-sections.jsx:339-340`) are intentional editorial content; they become `EDITORIAL_COMPARISON_PAIR.cheaper` / `EDITORIAL_COMPARISON_PAIR.expensive` after the refactor, NOT hardcoded literals. That counts as "literal-key access removed" under this directive.

## Non-Functional Requirements

- **Size/complexity budget:** ~150-250 LOC across 7 files (new `src/rates.mjs`, `src/constants.mjs` re-export update, 4 chart components, 1 new test file, 1 new helper file). The 4 chart files total 2,404 LOC. Flag at review if the diff materially exceeds the 150-250 LOC budget.
- **Threat model:** dashboard is public-facing but read-only and serves aggregated community data only. The refactor touches NO server endpoints, NO schemas, NO submission code. The new `src/rates.mjs` module is a pure-data export with no `node:` imports — explicitly so the browser bundle can consume it. No new secret-handling surface.
- **Maintainability constraints:** the pure-data module is the project's new single source of truth for "the models the dashboard knows about" and the "X vs baseline" reference. Existing Node consumers (`src/cli/analyze.mjs`) continue to import from `src/constants.mjs` via the re-export. Avoid parallel constants. The helper module `web/src/lib/model-metrics.mjs` is the home for any 2+-consumer accessor.
- **Performance/reliability:** chart renders are client-side, no server impact. Model lists are small (~7-10 entries even with growth) so `Object.entries()` iteration is O(n) trivial.
- **Load-bearing? yes** — the community dashboard at https://meter.vsits.co is the project's public-visible surface, and a refactor that breaks chart rendering is a user-visible regression on the day it ships. Visual-regression testing in-browser is required before merge. The refactor is mechanical, not semantic, but the load-bearing classification keeps the bar at "must verify in browser before merge," not "tests pass and call it done."

## Module split: `src/constants.mjs` → `src/rates.mjs` + `src/constants.mjs`

The current `src/constants.mjs` mixes pure data (`KNOWN_RATES`, `PLAN_LIST_PRICE_PER_DAY`, `HEADERS`, etc.) with Node-only setup (`homedir()`, `join()` at module-load to compute `CLAUDE_DIR`, `LOG_FILE`, `CONFIG_FILE`, `PROXY_LOG_FILE`, `INGEST_OFFSET_FILE`). The Node-only parts make the module unimportable from the browser bundle.

**Split into two:**

1. **`src/rates.mjs`** (new) — pure data, no `node:` imports:
   - `KNOWN_RATES` (move from constants.mjs)
   - `RATES_LAST_VERIFIED`, `RATES_SOURCE_URL` (move from constants.mjs)
   - `MODEL_DISPLAY_ORDER` (new)
   - `MODEL_BASELINE` (new)
   - `EDITORIAL_COMPARISON_PAIR` (new)
   - `PLAN_LIST_PRICE_PER_DAY` (move from constants.mjs — also pure data)

2. **`src/constants.mjs`** (existing, slimmed) — Node-only path setup. Re-exports `KNOWN_RATES`, `RATES_LAST_VERIFIED`, `RATES_SOURCE_URL`, `PLAN_LIST_PRICE_PER_DAY` from `./rates.mjs` so the existing call sites for those symbols see no API change. Actual call sites that import the moved symbols (verified against current tree, Codex round-1):
   - `src/cli/analyze.mjs:2` — imports the full set (`LOG_FILE, DEFAULT_SERVER, KNOWN_RATES, RATES_LAST_VERIFIED, RATES_SOURCE_URL, PLAN_LIST_PRICE_PER_DAY`)
   - `src/cli/rates.mjs:2` — imports just `KNOWN_RATES`

   Other `constants.mjs` consumers (`src/consent.mjs`, `src/cli/ingest.mjs`, `src/cli/setup.mjs`, `src/log/reader.mjs`, `src/log/writer.mjs`, `src/share/client.mjs`, `src/interceptor/fetch-patch.mjs`) import `LOG_FILE`/`CONFIG_FILE`/`MESSAGES_ENDPOINT`/`PROXY_LOG_FILE`/`INGEST_OFFSET_FILE`/`HEADERS`/`SCHEMA_VERSION` — Node-only path symbols that stay in `constants.mjs` and are NOT affected by the split.

The chart components import directly from `../../../src/rates.mjs`. The web's `vite.config.mjs` `server.fs.allow` may need a small entry pointing at the repo root (verify in implementation; if Vite refuses to serve files outside `web/`, the fix is one config line) — flag this in the implementation PR's pre-flight checks.

## The new constants in `src/rates.mjs`

```js
// Display order for the by-model cost chart and per-model comparison
// cards. The dashboard reads this list in declared order to populate
// chart series. Entries MUST be keys present in KNOWN_RATES, but
// KNOWN_RATES may contain models not listed here (the chart hides any
// KNOWN_RATES entry not in MODEL_DISPLAY_ORDER — useful for deprecated
// models like claude-opus-4-5 / claude-sonnet-4-5 / claude-haiku-3-5
// which are kept for historical pricing but don't belong on the chart).
//
// Ordering criterion: observed median cost-per-turn from the most recent
// submitted analysis (cheap → expensive). For a NEW model with no
// observed data yet, use the rate card as tiebreaker — sort by per-MTok
// input price ascending, then per-MTok output price ascending.
//
// Note: the existing chart order (haiku, opus-4-6, sonnet-4-6, opus-4-7)
// is observed cost-per-turn order, not rate-card order — sonnet $3 input
// sits after opus-4-6 $5 because opus-4-6 sessions are observably cheaper
// per turn than sonnet-4-6 sessions in our community data. Preserve that
// observed-cost convention when adding new models.
export const MODEL_DISPLAY_ORDER = [
  "claude-haiku-4-5",
  "claude-opus-4-6",
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "claude-fable-5",   // most expensive — rate card $10/$50 vs opus-4-7's $5/$25
];

// The "baseline" model for cost-per-turn comparison cards (e.g.,
// "haiku-4-5 is ~10× cheaper than opus-4-7"). The chart components
// pick this model's cost-per-turn as the reference value for the
// "X% vs baseline" annotations on each bar. Change this when the
// editorial story shifts (e.g., when opus-4-6 sunsets, move the
// baseline to the next-most-used model).
//
// INVARIANT: MUST be a key present in MODEL_DISPLAY_ORDER. A unit
// test asserts this at CI to fail-fast on misconfiguration before any
// production render.
// Renderer behavior when the baseline has zero data in the current
// window: surface the condition explicitly in the chart (e.g.,
// "baseline opus-4-6 has no data this window" subtitle), NOT a silent
// re-baseline.
export const MODEL_BASELINE = "claude-opus-4-6";

// The editorial cost-comparison pair surfaced in the per-model
// comparison cards (e.g., "haiku-4-5 is ~10× cheaper than opus-4-7").
// Both keys MUST be in MODEL_DISPLAY_ORDER. Change to retire the pair
// when the editorial story shifts. Unit test asserts both keys are
// in MODEL_DISPLAY_ORDER.
export const EDITORIAL_COMPARISON_PAIR = {
  cheaper: "claude-haiku-4-5",
  expensive: "claude-opus-4-7",
};
```

## Chart-component refactor

### `web/src/components/charts.jsx` (handles 5 literals at lines 239 + 244)

```diff
- const labelOrder = ["claude-haiku-4-5", "claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-7"];
- const colors = ["val", "info", "warn", "bad"];
+ import { MODEL_DISPLAY_ORDER, MODEL_BASELINE } from "../../../src/rates.mjs";
+ // The 4-color sequence matches the project's existing theme tokens.
+ // For MODEL_DISPLAY_ORDER entries beyond index 3, the color recycles
+ // by modulus — this is genuine recycle (NOT a new "neutral" token,
+ // which doesn't exist in the theme). Visual implication: the 5th model
+ // shares "val" with haiku-4-5, the 6th shares "info" with opus-4-6, etc.
+ // When the chart needs distinct colors for 5+ models, add a 5th theme
+ // token AND a corresponding ternary branch in lines :303-307.
+ const colors = ["val", "info", "warn", "bad"];
- const data = labelOrder
+ const data = MODEL_DISPLAY_ORDER
    .map((m, i) => ({
      name: shortenModel(m),
      y: metrics.modelCostPerTurn[m] || 0,
-     kind: colors[i],
+     kind: colors[i % colors.length],
    }))
    .filter((d) => d.y > 0);
- const baseline = metrics.modelCostPerTurn["claude-opus-4-6"] || 0;
+ const baseline = metrics.modelCostPerTurn[MODEL_BASELINE] || 0;
+ // NOTE: If `baseline === 0` here, the MODEL_BASELINE model has zero
+ // observed cost-per-turn in this dataset (it sunset, or no one in the
+ // community has submitted using it this window). The renderer below
+ // shows the chart but suppresses the "% vs baseline" annotation in
+ // that case, surfacing "baseline N/A" instead of silently picking a
+ // replacement.
```

The misconfiguration case (`MODEL_BASELINE` not in `MODEL_DISPLAY_ORDER`) is caught at CI by the unit test (see Test plan #1), not via a fail-soft `||` chain — this matches the hard/soft split the round-1 review correctly flagged.

**Also update `charts.jsx:277` and `:289` user-visible labels (Codex round-1).** The current copy `vs opus-4-6` (line 277) and `opus-4-6 baseline` (line 289) is hardcoded. After the refactor, both derive from `shortenModel(MODEL_BASELINE)`:

```diff
- `<span style="color:${t.muted};font-size:11px;">${sign}${vsBase}% vs opus-4-6</span>`;
+ `<span style="color:${t.muted};font-size:11px;">${sign}${vsBase}% vs ${shortenModel(MODEL_BASELINE)}</span>`;

- formatter: "opus-4-6 baseline",
+ formatter: `${shortenModel(MODEL_BASELINE)} baseline`,
```

### `web/src/components/sections.jsx` (lines 389-390, 515-516, 546-547 — 6 literals, plus :541 label)

Three patterns:

1. **For the per-model cost comparison cards** (lines 389-390, 515-516): introduce a `getModelMetric(metrics, modelKey, field)` helper in `web/src/lib/model-metrics.mjs` (see "Helper home" below). Replace literal-key access with `getModelMetric(metrics, MODEL_BASELINE, "modelCostPerTurn")` and the equivalent for the per-card targets.

2. **For the editorial-pair comparison card** (lines 546-547): replace `metrics.modelCostPerTurn["claude-haiku-4-5"]` with `getModelMetric(metrics, EDITORIAL_COMPARISON_PAIR.cheaper, "modelCostPerTurn")` and `claude-opus-4-7` with `EDITORIAL_COMPARISON_PAIR.expensive`. The card's editorial copy ("haiku-4-5 is X× cheaper than opus-4-7") gets templated against `shortenModel(EDITORIAL_COMPARISON_PAIR.cheaper)` and `shortenModel(EDITORIAL_COMPARISON_PAIR.expensive)` so changing the pair updates the copy automatically.

3. **For the baseline-annotation copy at :541 (Codex round-1):** the line currently reads `Bars annotated against the opus-4-6 baseline.` Derive this from `shortenModel(MODEL_BASELINE)` so changing the baseline constant updates the visible copy.

### `web/src/components/analysis-charts.jsx` (lines 215-216, plus :220,:224 labels)

Same data-lookup patterns. Same helper. **Plus the substitution-endpoint labels at :220 (`"All Opus 4.7"`) and :224 (`"All Haiku 4.5"`)** — derive from `shortenModel(EDITORIAL_COMPARISON_PAIR.expensive)` / `.cheaper` respectively. Without this, the chart's substitution-axis labels would be stale after a constant change (Codex round-1 catch).

### `web/src/components/analysis-sections.jsx` (lines 339-340, 388-389, plus :356-358,:371 labels)

Same data-lookup patterns. **Plus the substitution-copy block at :356-358 and the meta label at :371** — the body text reads `Hypothetical: substitute Haiku 4.5 for Opus 4.7 ...` and `Opus 4.7 costs ... Haiku 4.5 costs ...` while `:371` reads `Opus 4.7 baseline (X% headroom)`. All four derive from `shortenModel(EDITORIAL_COMPARISON_PAIR.cheaper/.expensive)` after the refactor.

## Helper home: `web/src/lib/model-metrics.mjs` (new)

```js
// Shared accessor for per-model metrics. Three+ chart components consume
// this; lives in `web/src/lib/` per the directive's rule on shared helpers.
export function getModelMetric(metrics, modelKey, field) {
  if (field === "avg_q5h_per_turn") {
    return metrics.modelSplits[modelKey]?.avg_q5h_per_turn || 0;
  }
  return metrics[field]?.[modelKey] || 0;
}
```

The helper is intentionally thin. If more sophisticated lookup logic (e.g., "fall back to a related model in the same family") is ever needed, it lives here. For now, the value of the helper is uniformity, not abstraction.

## Acceptance criteria

- Adding `claude-fable-5` to `MODEL_DISPLAY_ORDER` (which the round-2 example value does) causes Fable to appear at the declared position in the by-model cost chart (no separate code change needed).
- Adding a hypothetical `claude-sonnet-4-7` to `KNOWN_RATES` + `MODEL_DISPLAY_ORDER` works the same way (one-line add).
- Removing a model from `MODEL_DISPLAY_ORDER` (leaving it in `KNOWN_RATES`) hides it from the dashboard but the analyzer still prices it for historical data.
- The chart ordering stays observed-cost order for the existing 4 models (visual regression cost = 0 vs. current screenshots).
- The "baseline" reference (currently opus-4-6) is preserved in the editorial cards via `MODEL_BASELINE`; changing it to e.g. `"claude-opus-4-7"` swaps the baseline.
- Zero-data baseline window surfaces `"baseline N/A"` in the chart annotation rather than silently re-baselining.
- Misconfigured baseline (`MODEL_BASELINE` not in `MODEL_DISPLAY_ORDER`) fails the unit test at CI, not at production render time.

## Test plan

1. **Unit tests (new file `test/rates-display.test.mjs`):**
   - `MODEL_DISPLAY_ORDER` is a non-empty array of strings.
   - Every entry in `MODEL_DISPLAY_ORDER` is a key in `KNOWN_RATES`.
   - `MODEL_BASELINE` is a non-empty string.
   - `MODEL_BASELINE` is a key in `KNOWN_RATES`.
   - **`MODEL_BASELINE` is a key in `MODEL_DISPLAY_ORDER`** (the stronger invariant the round-1 review flagged as missing from the test plan).
   - `EDITORIAL_COMPARISON_PAIR.cheaper` and `.expensive` are both keys in `MODEL_DISPLAY_ORDER`.
   - **Uniqueness (Codex round-1):** `MODEL_DISPLAY_ORDER` has no duplicate entries (`new Set(MODEL_DISPLAY_ORDER).size === MODEL_DISPLAY_ORDER.length`).
   - **Distinctness (Codex round-1):** `EDITORIAL_COMPARISON_PAIR.cheaper !== EDITORIAL_COMPARISON_PAIR.expensive`.
   - **Re-export contract (Codex round-1):** import each of `KNOWN_RATES`, `RATES_LAST_VERIFIED`, `RATES_SOURCE_URL`, `PLAN_LIST_PRICE_PER_DAY` from BOTH `../src/rates.mjs` AND `../src/constants.mjs`. Assert referential equality (`rates.KNOWN_RATES === constants.KNOWN_RATES`, etc.). This locks the re-export contract — an implementation that omits or misspells a re-export name fails CI rather than shipping a broken `src/constants.mjs` surface.
2. **Visual regression:**
   - **Before screenshot:** capture from `https://meter.vsits.co/` (the production droplet, which is on `main`) BEFORE landing this directive's implementation. The implementation PR's reviewer checklist references the captured screenshot at a specific URL or attached file; the screenshot is captured by the implementation-PR author and posted in the PR body.
   - **After screenshot:** capture from a local `npm run dev` against the same production `/api/v1/stats` data after the refactor. Post in the implementation PR alongside the before screenshot.
   - Eyeball comparison: the existing 4-model chart should be visually identical (color order, sort order, bar heights, baseline annotation). Fable-5 appears at the declared position with its assigned color.
   - **Fable-less window case:** the chart's `.filter((d) => d.y > 0)` hides zero-data models, so if the production window happens to have no Fable submissions, the "Fable-5 appears" eyeball check is vacuous. When the production window lacks Fable rows, the implementation-PR author MUST also verify Fable rendering using a locally synthesized stats payload (inject a Fable row into the dev server's mock data or override the API response in the browser) and note this fallback path in the PR body. Without this, a Fable-less window could pass the eyeball check while the directive's load-bearing acceptance criterion is unverified.
3. **Integration on droplet:** after merge + deploy, fetch `https://meter.vsits.co/` and confirm Fable renders.

## Out of scope (explicit)

- **Server-side changes.** `/api/v1/stats` already returns every model in the data.
- **Analyzer changes.** `cost_analysis.by_model` already includes every `KNOWN_RATES` entry as of v0.7.1.
- **Schema changes.** `MeterRowSchema v:1` and `SharePayloadSchema v:1` don't move.
- **Dynamic baseline auto-selection** (e.g., "the model with the most calls this window"). The round-1 review correctly flagged this as a *worse* editorial product because it changes the meaning of every "X% vs baseline" annotation between visits. Keep `MODEL_BASELINE` explicit.
- **Backfill of historical Fable submissions.** Past submissions already have Fable in their `model_splits` — no schema reshape required.
- **Refactor of the helper to support fallback-by-family.** If future model adds want "fall back to the same-family model when this one has no data," that goes in a separate directive.

## Implementation order (single PR)

1. **Vite boundary pre-flight (Codex round-1).** Add `server.fs.allow: ['..']` to `web/vite.config.mjs` (relative to `web/` puts the repo root in scope). Current `web/vite.config.mjs:37-46` has no `fs.allow` — without this entry, `npm run dev` will refuse to serve `../../../src/rates.mjs` once it's imported. Production build (Rollup) follows filesystem paths fine; this is dev-only. Doing this first prevents the boundary failure from blocking the refactor mid-way. Concrete diff:
   ```diff
     server: {
       port: 5173,
   +   fs: {
   +     // Allow Vite to serve files from the repo root (src/rates.mjs is
   +     // imported by chart components from web/src/components/*.jsx).
   +     // Production Rollup build follows filesystem paths fine; this is
   +     // dev-only.
   +     allow: ['..'],
   +   },
     },
   ```
2. Create `src/rates.mjs` with `KNOWN_RATES`, `RATES_LAST_VERIFIED`, `RATES_SOURCE_URL`, `PLAN_LIST_PRICE_PER_DAY`, `MODEL_DISPLAY_ORDER`, `MODEL_BASELINE`, `EDITORIAL_COMPARISON_PAIR`. Pure-data module — no `node:` imports.
3. Slim `src/constants.mjs` to keep Node-only path setup; re-export the moved constants from `./rates.mjs` for backwards compatibility.
4. Verify the two call sites that import moved symbols (`src/cli/analyze.mjs:2`, `src/cli/rates.mjs:2`) still work via the re-export. No code changes elsewhere. Other `constants.mjs` consumers import Node-only path symbols that stay in `constants.mjs` and are unaffected by the split. The re-export contract test in test plan #1 enforces this at CI.
5. Create `web/src/lib/model-metrics.mjs` with `getModelMetric`.
6. Refactor `charts.jsx` to consume `MODEL_DISPLAY_ORDER`, `MODEL_BASELINE`, the helper, AND update the user-visible labels at `:277` (`vs opus-4-6`) and `:289` (`opus-4-6 baseline`) to derive from `shortenModel(MODEL_BASELINE)`.
7. Refactor `sections.jsx`, `analysis-charts.jsx`, `analysis-sections.jsx` to consume the helper and `EDITORIAL_COMPARISON_PAIR`. Update user-visible labels per the round-4 enumeration:
   - `sections.jsx:541` — derive baseline-annotation copy from `shortenModel(MODEL_BASELINE)`
   - `analysis-charts.jsx:220,224` — derive `All Opus 4.7` / `All Haiku 4.5` labels from `shortenModel(EDITORIAL_COMPARISON_PAIR.expensive)` / `.cheaper`
   - `analysis-sections.jsx:356-358,371` — same pattern; substitution copy + meta label
8. Add `test/rates-display.test.mjs` with the unit tests above.
9. Capture before/after screenshots from production droplet + local dev server.
10. CHANGELOG entry under `## [Unreleased]` documenting the new constants surface, the dashboard refactor, Fable-5's appearance, and the `src/rates.mjs` module split.

## Files modified / created

- `src/rates.mjs` (NEW) — pure-data constants module
- `src/constants.mjs` — slimmed; Node-only paths + re-exports from `./rates.mjs`
- `web/src/components/charts.jsx`
- `web/src/components/sections.jsx`
- `web/src/components/analysis-charts.jsx`
- `web/src/components/analysis-sections.jsx`
- `web/src/lib/model-metrics.mjs` (NEW) — shared accessor
- `web/vite.config.mjs` — if needed, `server.fs.allow` entry for the repo root
- `test/rates-display.test.mjs` (NEW) — unit tests
- `CHANGELOG.md` — Unreleased entry for v0.8.0

## Reviewer checklist (implementation PR)

- [ ] `src/rates.mjs` exists and has zero `node:*` imports. Verifiable: `grep -n '^import.*"node:' src/rates.mjs` returns nothing.
- [ ] `src/constants.mjs` re-exports `KNOWN_RATES`, `RATES_LAST_VERIFIED`, `RATES_SOURCE_URL`, `PLAN_LIST_PRICE_PER_DAY` from `./rates.mjs`.
- [ ] **Re-export contract test passes (Codex round-1):** importing each re-exported symbol from `../src/rates.mjs` and `../src/constants.mjs` returns referentially-equal values.
- [ ] Every entry in `MODEL_DISPLAY_ORDER` is a key in `KNOWN_RATES`. `MODEL_BASELINE` is a key in `MODEL_DISPLAY_ORDER`. `EDITORIAL_COMPARISON_PAIR.cheaper` and `.expensive` are both in `MODEL_DISPLAY_ORDER`.
- [ ] **Uniqueness (Codex round-1):** `MODEL_DISPLAY_ORDER` has no duplicate entries. **Distinctness:** `EDITORIAL_COMPARISON_PAIR.cheaper !== .expensive`.
- [ ] All four chart components import from `../../../src/rates.mjs` (and `../../lib/model-metrics.mjs` for the helper). No parallel constants.
- [ ] **Vite `server.fs.allow` entry added (Codex round-1):** `web/vite.config.mjs` has `server.fs.allow: ['..']` (or equivalent). Without this, `npm run dev` will refuse to serve `../../../src/rates.mjs`.
- [ ] No remaining literal-key model accesses in `web/src/components/*.jsx` EXCEPT through `MODEL_DISPLAY_ORDER`, `MODEL_BASELINE`, `EDITORIAL_COMPARISON_PAIR`, or `getModelMetric`. Verifiable: `grep -rEn '"claude-[a-z0-9-]+"' web/src/components/` should return nothing (or only string literals inside test fixtures).
- [ ] **No remaining literal-name labels (Codex round-1):** `grep -rEn 'opus-4-6|opus-4-7|haiku-4-5|sonnet-4-6|Opus 4\.6|Opus 4\.7|Haiku 4\.5|Sonnet 4\.6' web/src/components/` should return only references inside Opus-4.7-advisory copy (lines like `sections.jsx:227-228, 402, 404, 412, 415, 477, 528` reference the Opus 4.7 quota hypothesis specifically and stay hardcoded — those are content, not configurable labels). Every other reference should derive from `shortenModel(MODEL_BASELINE)` or `shortenModel(EDITORIAL_COMPARISON_PAIR.{cheaper,expensive})`.
- [ ] Color sequence: `i % colors.length` recycle is in place. No phantom `"neutral"` token.
- [ ] Zero-data baseline: chart shows `"baseline N/A"` annotation when `baseline === 0`, no silent re-baseline.
- [ ] Unit tests pass (`test/rates-display.test.mjs`).
- [ ] Vite build succeeds: `cd web && npm run build` returns clean.
- [ ] **Vite dev server boots clean:** `cd web && npm run dev` then load `http://localhost:5173` and confirm the dashboard renders without `fs.allow` errors in the dev-server console.
- [ ] Visual regression screenshots posted: production-droplet "before" and local-dev "after". Reviewer eyeballs both and confirms no regression.
- [ ] CHANGELOG entry calls out the new constants surface, the `src/rates.mjs` module split, the dashboard refactor, AND Fable-5's appearance.
