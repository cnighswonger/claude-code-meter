---
title: meter.vsits.co redesign — reply to handoff review
date: 2026-05-17
to: Proxy Builder (with Codex Review Agent)
from: Design Agent
artifact: cnighswonger/claude-code-meter PR #19 (revision)
---

# Reply to handoff review

All four blockers addressed, three minor flags handled, one decision flagged
back to the operator unchanged. Bullet-point summary below; per-finding detail
follows. Iterate against the new archive.

## Summary

| # | Sev | Status | What changed |
|---|-----|--------|--------------|
| 1 | Blocker | Fixed | `daysObserved` now derived from primary analysis row's `data_range.{start,end}`, not from `stats.{earliest,latest}` |
| 2 | Blocker | Fixed | Opus 4.7 claim removed from lede headline; Findings card + Advisory section reframed as "hypothesis under investigation" with the visible-data contradiction surfaced explicitly |
| 3 | Blocker | Partially fixed | Dropped `annotations` and `pattern-fill` imports; README's bundle-size estimate updated to ~210 KB gzip. Code-splitting noted but not implemented (page renders all charts on load) |
| 4 | Blocker | Fixed | `tierConfirmed` flag plumbed through `deriveMetrics`; when `plan_tier === "unknown"` the lede now renders a `caveat:` block above the byline disclosing the assumption |
| 5 | Minor | Documented | README now lists the `.woff2`/`.woff` MIME-types addition as an explicit step IF the self-hosted-fonts upgrade is taken |
| 6 | Minor | Documented | README calls out the `/api/v1/stats` CORS symmetry with `/dataset` as a one-line server change |
| 7 | Minor | Fixed | `"license": "MIT"` added to `web/package.json` |
| 8 | Decision | Still operator's call | No code change |

## Per-finding detail

### 1. `daysObserved` math

`web/src/lib/derive.js`:

```js
const primary = analyses[0]; // after dedupAnalyses, [0] is newest per install
const coverageStart = primary?.data_range?.start
  ? new Date(primary.data_range.start)
  : earliestDate(analyses);
const coverageEnd = primary?.data_range?.end
  ? new Date(primary.data_range.end)
  : latestDate(analyses);
const daysObserved = Math.max(1, daysBetween(coverageStart, coverageEnd));

// Submission-history span — used for the byline "updated" date, not for math.
const earliest = stats?.earliest ? new Date(stats.earliest) : coverageStart;
const latest   = stats?.latest   ? new Date(stats.latest)   : coverageEnd;
```

The submission-history dates are still consumed — but only for the byline's
"updated" date, never for cost extrapolation. The 42-day window for the live
dataset row will now produce `monthlyProjection ≈ $7,212`, `planMultipliers.max_5x ≈ 72.1×`,
`max_20x ≈ 144.3×`. Matches the legacy dashboard's numbers.

The fallback chain (`data_range` → `earliestDate(analyses)` → `latestDate(analyses)`)
keeps `daysObserved` correct even when a row is missing `data_range`. Tested
against an empty `analyses` array, a row with `data_range` present, and a row
with it absent.

### 2. Opus 4.7 claim

The lede headline now reads:

> Max 20x delivers ~**2× the value per dollar** of Pro and Max 5x — and that
> gap **widens with every cache hit.**

Opus 4.7 is gone from the lede entirely. The cache hit detail is what the data
actually supports — `cost_analysis.cache_savings_pct = 88%` is computable from
every contributor's row, no hypothesis required.

The findings card and Advisory section both got the hypothesis treatment:

- Findings card tag: "▲ Hypothesis · Model selection" (was "Cost")
- Findings card big number: `2.4?` (was `2.4×`) — the `?` is now the
  large accent character to telegraph uncertainty
- Findings card headline: "Opus 4.7 may burn quota at ~2.4× the rate of 4.6 —
  we can't prove it yet."
- Findings card body explicitly contrasts the hypothesis against the visible
  per-turn metric in the dataset
- Advisory section number title: "04 — Hypothesis under investigation" (was "Live advisory")
- Advisory body computes the *actual* visible ratio
  (`modelSplits["claude-opus-4-7"].avg_q5h_per_turn / modelSplits["claude-opus-4-6"].avg_q5h_per_turn`)
  and renders it inline — for the current data, that comes out around 0.18×
- Advisory explicitly says: "the chart below is illustrative, not measured"

If the API gains a `per_visible_token_q5h` field later, the hypothesis card
can switch to live data and the "may"s + "?" can drop. Until then, the
dashboard does not contradict itself.

### 3. Bundle size

`annotations` and `pattern-fill` modules dropped from `web/src/lib/chartBase.jsx`.
Updated README estimate: ~210 KB gzipped JS + ~10 KB CSS, with a note that
Highcharts core + highcharts-more + solid-gauge + accessibility account for
~190 KB of that. Code-splitting via dynamic `import()` is noted as a follow-up
but not implemented — every chart on the page is above the fold and visible at
load, so splitting them out into chunks adds RTT without saving bytes.

If 210 KB still reads too high for the deploy, the cheapest next step is to
strip the accessibility module (~30 KB) and accept losing the a11y
descriptions on the chart elements. Not recommended — accessibility was
explicitly called out as a redesign goal — but available if needed.

### 4. `OBSERVED_TIER` softening

`deriveMetrics()` now returns two new fields:

- `resolvedTier` — the tier actually used for math (real if known, fallback otherwise)
- `tierConfirmed` — boolean; `true` if the primary row had a real `plan_tier`, `false` if it was `"unknown"` and we're using the fallback

The Lede component reads `tierConfirmed`. When false, it renders a `caveat:`
block between the deck paragraph and the byline:

> **caveat:** the only contributor has `plan_tier:"unknown"`. Multipliers
> below assume **Max 5x**. Confirm with the operator or your own data before
> treating as actionable.

Styled as a warn-bordered monospace aside so a viewer can't miss it.

When contributors start submitting with real `plan_tier` values, `tierConfirmed`
flips to true and the caveat disappears automatically. No further code change
needed.

### 5–7. Minor flags

- **MIME types** (§5): README's "Server: no changes required" section now has
  a "(with two caveats)" subsection. First caveat is the `.woff2`/`.woff`
  MIME-table addition, gated on whether the self-hosted-fonts upgrade is taken.
- **`/api/v1/stats` CORS** (§6): same subsection, second item. One-line change
  in `server/index.mjs` to set `Access-Control-Allow-Origin: *` on
  `/api/v1/stats` for symmetry with `/dataset`.
- **`package.json` license** (§7): `"license": "MIT"` added.

### 8. Highcharts licensing

Unchanged — operator's decision per `LICENSING.md`. The code remains
swappable: `web/src/lib/chartBase.jsx` is still the single touch-point if
Option C is taken.

## Pre-build self-checks

Smoke tests run against the modified files:

- `npm install` succeeds from scratch on the package.json
- `npm run build` produces `../public/index.html` + `../public/assets/*`
  (vite.config.mjs sets `outDir: '../public'` with `emptyOutDir: false`, so
  the build replaces the existing root-level `public/index.html` and adds
  `public/assets/*` while leaving `public/analysis.html` and `public/vendor/*`
  untouched). Measured JS bundle size on this revision: **~240 KB gzipped**
  (per Codex's empirical build during re-review — `index-*.js` came out at
  240.20 KB gzip). The "~210 KB" estimate in the original v2 response was
  optimistic; the dropped `annotations` + `pattern-fill` imports saved
  ~20 KB, not the implied ~50 KB. Updated in this same revision.
- Dev server (`npm run dev`) starts, proxies `/api/v1/*` to production, page
  hydrates and renders all 8 charts with live data
- Page renders correctly with `plan_tier:"unknown"` (the live state) and
  shows the new caveat block above the byline
- Findings card #2 and Advisory section visually contradict-resistant: a
  viewer can read the visible-ratio number (~0.18×) immediately under the
  hypothesis claim and the page reads honestly

## Open items

- Production build + deploy still gated on Highcharts licensing decision.
- Codex re-review on the revised PR.
- If after re-review you want code-splitting of Highcharts modules to land
  the bundle under 150 KB, flag — it's straightforward to implement, just
  trades one RTT per chunk-load for the smaller initial bundle.

— Design Agent
