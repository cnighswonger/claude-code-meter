Codex review:

# Review: dashboard-dynamic-models (PR #27)

Date: 2026-06-10
Reviewed: `docs/directives/dashboard-dynamic-models.md` at `6f86d10`
Round: 1
Verdict: REQUEST_CHANGES
Label applied: None (`changes-requested` label is not present in this repo)

## What Is Correct

- The core architecture is right now. Moving browser-consumed data into `src/rates.mjs` while keeping `src/constants.mjs` as the Node-facing shim resolves the Vite/browser problem Fable caught and preserves the intended split between pure data and Node-only path setup.
- The allowlist model remains justified. `KNOWN_RATES` still contains historical models that should be priced but not rendered, so `MODEL_DISPLAY_ORDER` is still the correct source of dashboard membership rather than `Object.keys(KNOWN_RATES)`.
- Fable's round-2 nits are actually addressed in the round-3 directive: the Fable-less-window visual-regression fallback is now explicit at `docs/directives/dashboard-dynamic-models.md:211-215`, and the unmeasurable `~10%` clause is gone from the NFR budget at `docs/directives/dashboard-dynamic-models.md:48`.
- The semver framing as a minor release is reasonable if the re-export contract really stays intact: `src/rates.mjs` is additive, and `src/constants.mjs` remains the stable import path for existing Node consumers.

## Blockers

### 1. The Node-side compatibility promise is not pinned to the real consumers or to an automated test

The directive claims the `src/constants.mjs` re-export preserves existing consumers at `docs/directives/dashboard-dynamic-models.md:68`, repeats that in implementation step 3 at `docs/directives/dashboard-dynamic-models.md:230-231`, and checks only for the re-export statement itself at `docs/directives/dashboard-dynamic-models.md:256`. But the current tree shows the moved symbols are consumed specifically by `src/cli/analyze.mjs:2` and `src/cli/rates.mjs:2`; there are no `server/` consumers and no `src/ingest/` directory matching the directive's wording. More importantly, the test plan at `docs/directives/dashboard-dynamic-models.md:204-210` never asserts that `src/constants.mjs` still exports `KNOWN_RATES`, `RATES_LAST_VERIFIED`, `RATES_SOURCE_URL`, and `PLAN_LIST_PRICE_PER_DAY`.

That leaves a real gap: an implementation can satisfy every listed unit assertion, keep `src/rates.mjs` internally correct, and still break the shipped Node surface by omitting or misspelling one re-export. Because `package.json` ships `src/` and the directive explicitly treats this as a non-breaking minor, the compatibility claim needs to be enforced, not just stated.

What to change in the directive:
- Replace the hand-wavy consumer inventory with the actual moved-symbol call sites (`src/cli/analyze.mjs`, `src/cli/rates.mjs`) or with symbol-level wording.
- Extend test plan #1 so it imports the moved symbols from both `src/rates.mjs` and `src/constants.mjs` and asserts the `src/constants.mjs` names still exist and match the new source of truth.

### 2. `MODEL_BASELINE` and `EDITORIAL_COMPARISON_PAIR` are not carried through all user-visible copy they are supposed to control

The directive correctly introduces `MODEL_BASELINE` and `EDITORIAL_COMPARISON_PAIR` at `docs/directives/dashboard-dynamic-models.md:101-125`, and it explicitly says the pair copy should update automatically at `docs/directives/dashboard-dynamic-models.md:171` and that changing the baseline should swap the reference at `docs/directives/dashboard-dynamic-models.md:198`. But the concrete refactor instructions only talk about replacing keyed data lookups. They do not enumerate the visible labels that remain hardcoded to the old model names in the current components:

- `web/src/components/charts.jsx:277` still says `vs opus-4-6`
- `web/src/components/charts.jsx:289` still says `opus-4-6 baseline`
- `web/src/components/sections.jsx:541` still says `Bars annotated against the opus-4-6 baseline`
- `web/src/components/analysis-charts.jsx:220,224` still label the substitution endpoints as `All Opus 4.7` / `All Haiku 4.5`
- `web/src/components/analysis-sections.jsx:356-358,371` still hardcode `Haiku 4.5` and `Opus 4.7` in the substitution copy and meta label

An implementation that follows the directive literally can therefore end up with constant-driven math but stale on-screen text. That breaks the directive's own "change the constant, update the story" promise.

What to change in the directive:
- Call out these copy surfaces explicitly in the refactor section and/or reviewer checklist.
- Require the implementation to derive the visible labels from `MODEL_BASELINE` and `EDITORIAL_COMPARISON_PAIR` as well as the numeric lookups, likely via `shortenModel(...)`.

## What Needs Attention

1. The Vite boundary check is in the wrong place in the implementation order. The directive already knows `web/vite.config.mjs:37-46` has no `server.fs.allow`, but it postpones that verification until step 7 at `docs/directives/dashboard-dynamic-models.md:235`. This is the first thing that can stop local implementation work once `../../../src/rates.mjs` is imported. Move the pre-flight to step 1 or 2, and give the implementation agent a concrete config sketch instead of "may need a single entry."

2. Test plan #1 should also lock down uniqueness invariants. As written at `docs/directives/dashboard-dynamic-models.md:205-210`, duplicate entries in `MODEL_DISPLAY_ORDER` would still pass, and `EDITORIAL_COMPARISON_PAIR.cheaper === .expensive` would also still pass. Both would yield a visibly wrong dashboard while satisfying the current six assertions.

3. One wording bug remains after the round-3 nit cleanup: `docs/directives/dashboard-dynamic-models.md:163` still says the misconfiguration case is caught "at module load via the unit test." The round-3 doc-comment fix at `docs/directives/dashboard-dynamic-models.md:108-110` correctly moved this to CI-time; the prose below the diff should match.

## Bloat / Non-Functional

None.

## Recommendations

- Add one more unit-test cluster to `test/rates-display.test.mjs` for the `src/constants.mjs` re-export contract.
- Expand the directive's scope statement from "17 literal-key accesses" to "17 literal-key accesses plus the baseline/pair labels that must now derive from constants," so the implementation agent does not stop at the data lookups.
- Move the Vite `server.fs.allow` check to the front of the implementation order and include the expected config shape in the directive text.
- Add uniqueness assertions for `MODEL_DISPLAY_ORDER` and distinctness for `EDITORIAL_COMPARISON_PAIR`.

## Bottom Line

The directive is close, and the architecture is in the right place after Fable's two rounds. But it still leaves one backwards-compatibility promise untested and one configurability promise only half-specified. Both are directive-stage problems, not implementation-stage cleanup: a faithful implementation could pass the current test plan and still either break `src/constants.mjs` consumers or ship stale on-screen baseline/pair labels. Fix those two gaps and this should be ready to approve.

— Codex review
