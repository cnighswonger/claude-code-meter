# Directive Review: dashboard-dynamic-models (claude-code-meter PR #27)

**Date:** 2026-06-10
**Reviewed:** `docs/directives/dashboard-dynamic-models.md` (167 lines, new file, branch `feature/dashboard-dynamic-models`)
**Round:** 1
**Verdict:** REQUEST_CHANGES

All findings below were verified against the actual tree at `origin/main` (8fd0158), not just the directive text.

---

## What Is Correct

- **The problem statement is accurate and the line citations check out.** Every cited reference site exists at the cited line: `charts.jsx:239` (the `labelOrder` array), `charts.jsx:244` (the opus-4-6 baseline), `sections.jsx:389-390, 515-516, 546-547`, `analysis-charts.jsx:215-216`, `analysis-sections.jsx:339-340, 388-389`. The failure mode described in the Goal (`docs/directives/dashboard-dynamic-models.md:10`) is real — `KNOWN_RATES` gained `claude-fable-5` in v0.7.1 and no chart component can render it.

- **The allowlist rationale for `MODEL_DISPLAY_ORDER` is concretely true, not hypothetical.** `KNOWN_RATES` currently holds 8 models, including `claude-opus-4-5`, `claude-sonnet-4-5`, and `claude-haiku-3-5` — none of which belong on the dashboard but all of which need pricing for historical data. `Object.keys(KNOWN_RATES)` would render all 8. The "explicit allowlist" argument (`docs/directives/dashboard-dynamic-models.md:38-43`) is the right call over reading keys directly, and the constants are the right primitives: a helper function would still need an ordering/allowlist source, which is exactly what these constants are.

- **Scope boundaries are correctly drawn.** Verified: no server endpoint, schema, or analyzer coupling — `modelCostPerTurn` and `modelSplits` arrive via the API with all models present; the gap is purely client-side key access. The out-of-scope items at `docs/directives/dashboard-dynamic-models.md:131-137` are genuine non-requirements, with one internal-consistency exception flagged below.

- **Dynamic-baseline deferral is defensible.** Auto-selecting the baseline per data window would change the meaning of every "X% vs baseline" annotation between visits — a worse editorial product, not a deferred improvement. Keeping `MODEL_BASELINE` explicit (`docs/directives/dashboard-dynamic-models.md:137`) is the right design, not deferred complexity. (One edge of it leaks back in anyway — see Needs Attention #2.)

- **Size budget and structure are sound.** The 4 chart files total 2,404 LOC (directive says "2.6K" — close enough), the ~150-250 LOC budget is plausible for a mechanical refactor, and the implementation order, files list, and CHANGELOG requirement are all complete.

---

## Blockers

### 1. The specified import path cannot work: `src/constants.mjs` is not browser-safe

The diff sketch (`docs/directives/dashboard-dynamic-models.md:80`) and the reviewer checklist (`docs/directives/dashboard-dynamic-models.md:162`) both mandate that the four chart components `import { MODEL_DISPLAY_ORDER, MODEL_BASELINE } from "../../../src/constants.mjs"`. But `src/constants.mjs:1-2` imports `node:os` and `node:path`, and lines 6-8 call `homedir()`/`join()` at module evaluation time. The web app is a Vite + React browser build (`web/vite.config.mjs`); Vite externalizes `node:` builtins for browser targets and `homedir()` does not exist there — the bundle breaks at module load. Note that `web/` currently has **zero** imports from `src/` and its own `package.json`; this directive would be the first cross-boundary import, and the boundary is not crossable as specified. (Secondary: `web/`'s separate package.json may also set Vite's workspace root to `web/`, putting `../../../src` outside the default `server.fs.allow` in dev.)

The fix is small but it must be in the directive, because the checklist enforces the broken path: put the display constants (and ideally `KNOWN_RATES` itself) in a new pure-data module with no `node:` imports — e.g., `src/model-display.mjs` or `src/rates.mjs` — and have `src/constants.mjs` re-export for existing consumers. The chart components import the pure module. The directive's own hedge — "(or whatever the chart→constants path resolves to)" at `docs/directives/dashboard-dynamic-models.md:162` — suggests this was not actually tried.

### 2. The proposed `MODEL_DISPLAY_ORDER` violates its own ordering invariant

The constant's doc comment mandates "Order: cheap → expensive" (`docs/directives/dashboard-dynamic-models.md:47-49`), and the proposed value places `claude-fable-5` fourth, *before* `claude-opus-4-7` (`docs/directives/dashboard-dynamic-models.md:50-56`). But Fable-5 is the most expensive model in `KNOWN_RATES`: $10/$50 per MTok vs opus-4-7's $5/$25 (`src/constants.mjs:30,57`) — 2× on the rate card, and our own fleet telemetry puts Fable's per-call cost multiplier at ~2.2×. By any criterion, Fable belongs last. As written, the directive's own example value ships a violation of the directive's own convention into the constant whose entire purpose is encoding that convention.

Two sub-issues to fix together: (a) move `claude-fable-5` after `claude-opus-4-7`; (b) state *which* cost metric defines the order — note that the existing chart order (haiku, opus-4-6, sonnet-4-6, opus-4-7) is already not rate-card order (sonnet $3 input sits after opus-4-6 $5), so the convention is presumably observed cost-per-turn, and the comment should say so. Without a stated criterion, "insert at the position that preserves the sort" is unactionable for future model adds — which defeats the one-line-add promise.

---

## What Needs Attention

1. **Internal contradiction: hardcoded editorial pair vs. "no remaining literal-key accesses" checklist.** The out-of-scope section keeps the "haiku-4-5 is X× cheaper than opus-4-7" pair hardcoded (`docs/directives/dashboard-dynamic-models.md:136`), and the refactor section says the pair can be swapped "via a constant" (`docs/directives/dashboard-dynamic-models.md:106`) — but no such constant is defined in the schema section, and the checklist demands "No remaining literal-key model accesses in `web/src/components/*.jsx`" (`docs/directives/dashboard-dynamic-models.md:163`). These three statements cannot all be satisfied. Either define the implied third constant (e.g., `EDITORIAL_COMPARISON_PAIR`) in the schema section, or soften the checklist item to "no literal-key accesses except the documented editorial pair."

2. **The baseline fail-soft chain silently changes editorial meaning.** `metrics.modelCostPerTurn[MODEL_BASELINE] || metrics.modelCostPerTurn[MODEL_DISPLAY_ORDER[0]] || 0` (`docs/directives/dashboard-dynamic-models.md:90`) conflates two distinct conditions: a *misconfigured* baseline (the case the doc comment at line 66-67 describes) and a *valid baseline with zero data in the current window*. When opus-4-6 traffic eventually drops to zero — the directive itself anticipates its sunset at line 62-63 — every "X% vs baseline" annotation silently re-baselines to haiku with no signal to anyone. A misconfiguration should be loud (a `console.warn` plus a unit-test assertion that `MODEL_BASELINE ∈ MODEL_DISPLAY_ORDER` — currently the test plan at line 126 only asserts membership in `KNOWN_RATES`, which is the weaker check despite the doc comment at line 65 requiring the stronger one); a zero-data window is an editorial decision that should be made by a human, not a `||` chain.

3. **The color sketch is internally inconsistent and references a token that doesn't exist.** The comment says "recycle the last color" (`docs/directives/dashboard-dynamic-models.md:82-83`) but the code adds a fifth token `"neutral"` (`docs/directives/dashboard-dynamic-models.md:84`) — so with 5 models and 5 colors, `Math.min` never recycles and Fable gets `"neutral"`. But no `neutral` token exists anywhere in `web/src`: the render ternaries (`charts.jsx:304-307` and `:223-226`) fall through to the **`bad`** gradient for unknown kinds, so Fable would silently render in the same color as opus-4-7, with no crash and no warning. The checklist item at line 164 ("recycles or extends; doesn't crash") would pass while the chart misleads. Directive-stage sketches may be illustrative, but this one should pick a lane: either drop `"neutral"` and genuinely recycle, or require a new theme color *and* a new ternary branch.

4. **`getModelMetric` needs a declared home.** The helper (`docs/directives/dashboard-dynamic-models.md:98-103`) is introduced under the `sections.jsx` heading but lines 110-115 apply the "same pattern" to `analysis-charts.jsx` and `analysis-sections.jsx`. Three consumers means a shared module under the directive's own rule ("No new abstraction unless 2+ components consume it", line 31) — the directive should name where it lives (e.g., `web/src/lib/model-metrics.mjs`) rather than leave it to per-file duplication, which would be its own form of the parallel-constant antipattern.

5. **Visual regression step: tractable but tighten one assumption.** The plan (`docs/directives/dashboard-dynamic-models.md:127`) is operationally real — `npm run dev` proxies live prod data per `web/vite.config.mjs`, so before/after screenshots against identical data are genuinely capturable. Two tightenings: require the *before* screenshot to be captured from `main` prior to the refactor (otherwise there is no baseline to eyeball against — the directive assumes "current screenshots" exist at line 121 without saying who captures them or where they live), and note that "Fable appears" depends on the prod data window actually containing Fable rows at test time (it should, given fleet usage, but a quiet window would fail the check confusingly). On the AITL question in the PR body: yes, adding a screenshot-capture step to the implementation PR's reviewer checklist is cheap and worth it — this is the project's public face.

---

## Precision Issues

1. **"11 references" doesn't match any counting scheme** (`docs/directives/dashboard-dynamic-models.md:14`). The cited sites span **14 lines containing 17 model-name literals** (charts.jsx:239 alone holds 4). Counting grouped sites gives 8. None of the natural counts yields 11. The line citations themselves are all accurate, so this is cosmetic — but in a directive whose checklist says "no remaining literal-key accesses," the enumeration count is the thing the implementer greps against. State it as "17 literals across 14 lines in 4 files."

2. **The acceptance criteria reference a "model-split chart"** (`docs/directives/dashboard-dynamic-models.md:118`) **that is not among the 11 enumerated references.** `modelSplits` is accessed only in the sections/analysis-sections comparison *cards* (verified by grep); no chart component reads it. Either the criterion refers to a surface that's already dynamic (in which case it's vacuously satisfied and should be cut) or to a surface that doesn't exist. Name the actual surfaces.

3. **"import `KNOWN_RATES` keys (not rates); no rate data leaks"** (`docs/directives/dashboard-dynamic-models.md:29`) is technically wrong as stated. Importing *anything* from a module pulls the module in; only production tree-shaking separates the keys from the rates, and the top-level `homedir()`/`join()` calls in `src/constants.mjs:6-8` are side effects that can defeat it. The conclusion stands — the rates are already public in source and CHANGELOG, as the same sentence concedes — but the mechanism claim should be corrected, and the constants-module split required by Blocker 1 makes the claim true for free.

4. **"this changes ~10% of each file's model-resolution code paths"** (`docs/directives/dashboard-dynamic-models.md:28`) — "10% of the code paths" and "10% of each file" are different claims and neither is measurable at review time. The LOC budget alone (150-250) is the enforceable number; drop the percentage.

---

## Bottom Line

The diagnosis is verified-correct, the two-constants design is the right primitive set (the allowlist argument is concretely supported by three deprecated models already in `KNOWN_RATES`), and the scope boundaries are honest. But the directive as written specifies a mechanism that does not build — `src/constants.mjs` cannot be imported into a Vite browser bundle while it imports `node:os` — and its flagship example value places Fable-5 in a position that violates the ordering invariant the constant exists to encode. Both blockers have small, obvious fixes (a pure-data constants module; move Fable last and state the ordering criterion), and the needs-attention items (the editorial-pair contradiction, the silent baseline fallback, the phantom `neutral` color token) are each a paragraph of directive text to resolve. One revision round should get this to APPROVE. Not publication-ready as-is.

— Fable 5 Review
