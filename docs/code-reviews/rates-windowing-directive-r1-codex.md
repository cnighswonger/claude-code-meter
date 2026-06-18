Verdict: REQUEST_CHANGES

# Review: PR #35 — rates Q5h-windowing directive

Date: 2026-06-18
Reviewed: `docs/directives/rates-windowing.md` at `fe6bcd7`
Round: 1
Label applied: `changes-requested`

## Findings

### Blockers

1. The directive adds required CLI flags but does not contract the real top-level parser update or acceptance-test it.

   The directive makes `--tier-start-date <YYYY-MM-DD>` required for v1 and introduces `--by <window|row>` with `window` as default and `row` as a one-release escape hatch: `docs/directives/rates-windowing.md:77`, `docs/directives/rates-windowing.md:89`, `docs/directives/rates-windowing.md:129`. Today those flags cannot reach `ratesCommand` because `bin/claude-meter.mjs` owns `parseArgs`, does not declare either `by` or `tier-start-date`, and only forwards the generic `args` object at `bin/claude-meter.mjs:16`, `bin/claude-meter.mjs:18`, `bin/claude-meter.mjs:87`, `bin/claude-meter.mjs:107`.

   That is not just an implementation detail. The directive's tests target `ratesCommand` directly at `docs/directives/rates-windowing.md:141`, but a passing direct-call test can still leave `claude-meter rates --tier-start-date ...` broken at the CLI boundary. The contract needs to name `bin/claude-meter.mjs` as an implementation surface and require at least one CLI-level parser/dispatch test for `--by row`, missing `--tier-start-date`, and accepted `--tier-start-date`.

2. The proposed AITL fixture shape cannot prove the chronology-dependent acceptance criteria in the directive.

   The directive says the fixture is only 90 records shaped as `{ cache_read_M, cache_create_M, input_M, output_M, q5h_max }`: `docs/directives/rates-windowing.md:148`. It also says the sample is shuffled and has no timestamps or source attribution: `docs/directives/rates-windowing.md:35`. But the load-bearing behavior depends on chronology: exclude the in-progress current window, hold out the most-recent qualifying completed window, and ensure the held-out window is the most-recent qualifying window rather than the literal last entry: `docs/directives/rates-windowing.md:101`, `docs/directives/rates-windowing.md:103`, `docs/directives/rates-windowing.md:145`.

   With no `q5h_reset`, no timestamp, and intentionally shuffled order, the fixture can validate the regression math and broad weight targets, but it cannot validate the "most-recent qualifying completed window" rule or current-window exclusion. The directive needs either chronology-safe fixture fields, a separate non-private synthetic chronology fixture named as the authoritative test for those rules, or a clarified statement that the AITL fixture is regression-only and does not exercise holdout/window-completion semantics.

3. The model/tier isolation contract is incomplete for mixed-model windows.

   The directive correctly states that fitting must stay within a single `(model, tier)` regime: `docs/directives/rates-windowing.md:91`. The current command emits separate regressions by `model|speed`: `src/cli/rates.mjs:31`, `src/cli/rates.mjs:39`, and the new directive output remains model-specific: `docs/directives/rates-windowing.md:50`. But the new implementation surface only says to filter by `--tier-start-date`, group by `q5h_reset`, and regress windows: `docs/directives/rates-windowing.md:129`, `docs/directives/rates-windowing.md:131`. It does not say whether grouping happens per `model|speed`, whether mixed-model Q5h windows are excluded, or whether mixed-model windows should be fit as combined account-level observations.

   That ambiguity matters because `q5h_max` is an account-window total while token columns can be model-scoped. Two implementers could both pass the single-model 90-window fixture at `docs/directives/rates-windowing.md:148` and produce materially different behavior on real logs containing multiple models. The directive should explicitly define the mixed-model window rule and add a small acceptance test for it.

### Attention Items

1. The fixture/manual-smoke path is underspecified.

   The verification section calls `node src/cli/rates.mjs --tier-start-date 2026-05-23 --fixture test/fixtures/aitl-anonymized-90-windows.json`: `docs/directives/rates-windowing.md:163`. There is no current standalone entrypoint or arg parsing in `src/cli/rates.mjs`; it exports `ratesCommand(args)` and reads the default log directly at `src/cli/rates.mjs:12`, `src/cli/rates.mjs:13`. If `--fixture` is intended as a real dev/test flag, the directive should contract where it is parsed and whether it accepts aggregated-window fixtures or JSONL rows. If it is only pseudocode, remove it from load-bearing verification.

2. Cache-fix marker detection needs one more byte-contract sentence.

   The directive says to detect `_workflowAgentId` or `request_id` extension markers: `docs/directives/rates-windowing.md:115`. The current meter row schema has `request_id` as an optional upstream response-id field at `src/log/schema.mjs:105`, while the schema's cache-fix agent attribution fields are `agent_id` and `agent_id_source` at `src/log/schema.mjs:115`. The heuristic may still be right, but the directive should name the exact row keys and expected value semantics so implementation review is not forced to infer whether any `request_id` counts or only proxy-emitted request IDs count.

3. Dashboard non-consumption is verified, but the directive should cite the actual code path in the implementation PR.

   I verified the dashboard fetches `/api/v1/stats` and `/api/v1/dataset?limit=1000` in `web/src/lib/api.js:12`, derives metrics from submitted analysis rows in `web/src/lib/derive.js:38`, and imports only pure rate-card constants from `src/rates.mjs` in `web/src/components/sections.jsx:17` and `web/src/components/charts.jsx:13`. The current `public/index.html` is just a built Vite shell loading assets at `public/index.html:13`. I did not find a dashboard import of `src/cli/rates.mjs`. This supports the CLI-surface decision in `docs/directives/rates-windowing.md:41`, but the implementation review should keep the same spot-check.

4. The NFR section is mostly complete, but the missing root `AGENTS.md` should be cleaned up separately.

   The directive covers size/complexity, threat model, maintainability, performance/reliability, and load-bearing classification at `docs/directives/rates-windowing.md:31`. The load-bearing classification as "No" is defensible for a CLI-only semantics change with no schema or wire change: `docs/directives/rates-windowing.md:41`. However, this checkout and `origin/main` do not contain the repo-root `AGENTS.md` the task prompt said should hold repo-specific review conventions; `git ls-tree -r --name-only HEAD` shows existing `docs/code-reviews/` artifacts but no `AGENTS.md`. I applied the user-provided global rules and the established NFR template visible in `docs/directives/agent-id-schema-addition.md:27` and `docs/directives/dashboard-dynamic-models.md:67`.

### Nits

- `docs/directives/rates-windowing.md:39` says held-out validation is "one OLS fit per left-out window" but then immediately says v1 holds out only the most-recent qualifying window unconditionally. Rewrite this as a single hold-out-last-window contract so implementers do not waste time building leave-one-out machinery.
- `docs/directives/rates-windowing.md:105` says sparse users can re-run `--by row` until it is removed, but `--by row` is explicitly deprecated because it produces unreliable weights at `docs/directives/rates-windowing.md:77`. Keep the escape hatch, but phrase the error guidance as "collect more data or use deprecated `--by row` only for legacy comparison."

## What Is Correct

- The core move from per-row `q5h_delta` regression to per-Q5h-window aggregation is well motivated by the quantization problem: `docs/directives/rates-windowing.md:16`, `docs/directives/rates-windowing.md:18`, and it matches the current per-row implementation that feeds `q5h_delta` directly to OLS at `src/cli/rates.mjs:49`, `src/cli/rates.mjs:61`, `src/cli/rates.mjs:64`.
- Reusing the existing OLS/inversion code is the right maintainability cut. The current OLS path is isolated in `src/cli/rates.mjs:117` and `src/cli/rates.mjs:157`, and the directive keeps the change as a new aggregation path rather than a new statistics subsystem at `docs/directives/rates-windowing.md:37`.
- Adding `groupByQuotaWindow(rows)` beside the existing `filterByQuotaWindow(rows)` is coherent. The current helper intentionally returns only the largest single window at `src/log/reader.mjs:45` and `src/log/reader.mjs:55`, while this feature needs all windows as stated at `docs/directives/rates-windowing.md:123`.
- The out-of-scope cuts are appropriate. Tier-start inference, weight-history ledger, drift detection, per-tier auto-detection, public-share schema, and dashboard rendering are explicitly deferred at `docs/directives/rates-windowing.md:167`, and #34 is correctly treated as dependent follow-up work rather than part of this directive at `docs/directives/rates-windowing.md:3`.
- The single-branch directive-plus-implementation process is acceptable for this narrow CLI contract, provided amendments land before implementation drift as required at `docs/directives/rates-windowing.md:176`.

## Bottom Line

The direction is right, and the NFR/load-bearing call is broadly honest, but the directive is not yet tight enough to govern implementation. It leaves the actual CLI parser out of scope despite adding required user-facing flags, proposes a privacy-safe fixture shape that cannot validate chronology-dependent holdout behavior, and does not define mixed-model window handling. Those are contract gaps that can let two implementations pass the named tests while behaving differently in real use. Revise the directive before implementation commits land.

— Codex review
