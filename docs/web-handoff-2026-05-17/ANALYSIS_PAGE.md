---
title: meter.vsits.co — Deep Analysis page redesign (handoff addendum)
date: 2026-05-20
to: Proxy Builder
from: Design Agent (chart layer ported to ECharts by Proxy Builder)
artifact: cnighswonger/claude-code-meter — `feature/web-deep-analysis-page` sub-branch
---

# Deep Analysis page — redesign addendum

The dashboard at `/` was redesigned + deployed in the prior round (PR #19, 2026-05-20). `/analysis.html` was left at its pre-redesign state and now looks visibly stale next to the new dashboard. This addendum adds a redesigned Deep Analysis page to the same Vite project, sharing all libs/components with the dashboard.

**Nothing about the dashboard build changes structurally.** This is purely additive: new entry point + new components alongside the existing ones, plus a small edit to `vite.config.mjs` to enable the second entry.

---

## Provenance note

Design Agent's archive (`/tmp/Claude Meter(2).zip`, generated 2026-05-20) was built against a snapshot of the project *before* PR #19 merged — i.e. against the Highcharts version of `chartBase.jsx` / `charts.jsx`. The archive's chart wrapper, dashboard chart components, and `package.json` were therefore regression-state and were NOT applied. The archive's deploy README also referenced the previous droplet IP that was scrubbed during PR #19. Treated those files as stale and applied only the genuinely-new files:

- `web/analysis.html` (new Vite entry)
- `web/src/analysis-main.jsx` (React entry)
- `web/src/AnalysisApp.jsx` (top-level composition)
- `web/src/components/analysis-sections.jsx` (section components)
- `web/src/components/analysis-charts.jsx` (**ported from Highcharts to Apache ECharts** by Proxy Builder against the new chartBase.jsx)
- `web/vite.config.mjs` (added `rollupOptions.input.analysis` entry)

`web/src/lib/chartBase.jsx` got one additional component registration (`LineChart`) needed by the new analysis-page charts. The rest of chartBase.jsx is unchanged from the PR #19 state.

---

## What's new

| File | Purpose |
|------|---------|
| `web/analysis.html` | Second Vite entry, mirrors `index.html` shape |
| `web/src/analysis-main.jsx` | React entry, mirrors `main.jsx` |
| `web/src/AnalysisApp.jsx` | Top-level composition for the analysis page |
| `web/src/components/analysis-sections.jsx` | Section components (Nav, Lede, six numbered sections, Methodology, Footer) |
| `web/src/components/analysis-charts.jsx` | Five new ECharts components specific to this page |
| `web/vite.config.mjs` | **edited** — adds the second entry to `rollupOptions.input` |
| `web/src/lib/chartBase.jsx` | **edited** — adds `LineChart` to the registered component set |

Everything else (`lib/api.js`, `lib/derive.js`, the dashboard's `components/charts.jsx`, `components/sections.jsx`, `styles.css`) is reused verbatim from the dashboard build.

---

## The five analysis-page charts

All ported to ECharts using the patterns established in the dashboard's `charts.jsx`:

| Chart | Type | ECharts pattern |
|-------|------|-----------------|
| `CapacityScenarioChart` | Clustered column | Multiple `bar` series sharing a category xAxis. Tooltip uses `trigger:'axis'` with a custom HTML formatter to preserve per-series rows. |
| `CacheSensitivityChart` | Area | `type:'line'` + `areaStyle` with a linear-gradient fill. The "observed 88%" reference line is a `markLine` on the x-axis. |
| `QuotaWindowsChart` | Horizontal bar | `type:'bar'` with category yAxis + value xAxis. The 24h and 168h day/week reference lines are `markLine` entries on the x-axis. |
| `SubstitutionChart` | Column | Standard ECharts `bar` mirroring the dashboard's `ModelCostChart` shape; first and last bars use kind-specific gradient colors to anchor the "all Opus" → "all Haiku" gradient. |
| `HypothesisRangeChart` | Smoothed line | `type:'line'` with `smooth:true`. The `y=1.0` parity line and `y=2.4` hypothesis-ratio line are both `markLine` entries with distinct dash styles. |

---

## Deploy

The deploy flow is unchanged from PR #19 (now that the droplet has 2 GB of swap, build-on-droplet works again). Per the canonical handoff README in this folder:

```bash
ssh root@<droplet>    # host details in internal deployment notes
cd /opt/claude-code-meter
git checkout -- package-lock.json
git pull --ff-only origin main
cd web
npm ci
npm run build                              # now writes BOTH index.html and analysis.html + shared assets/
cd ..
systemctl restart claude-meter             # static files don't require this; defensive
curl -s -o /dev/null -w "%{http_code}\n" https://meter.vsits.co/                  # → 200
curl -s -o /dev/null -w "%{http_code}\n" https://meter.vsits.co/analysis.html     # → 200
```

**Build output** post-PR-#21 (this sub-branch):

```
../public/index.html                  ~1.0 kB  (gzip ~0.4 kB)
../public/analysis.html               ~1.1 kB  (gzip ~0.5 kB)
../public/assets/index-*.js           ~1.3 kB  (gzip ~0.6 kB)
../public/assets/analysis-*.js       ~27.9 kB  (gzip ~7.9 kB)
../public/assets/<shared>-*.js      ~794 kB    (gzip ~263.5 kB)
../public/assets/<shared>-*.css      ~13.3 kB  (gzip ~3.3 kB)
```

Per-page wire weight on a fresh visit:
- Dashboard (`/`): ~264 KB gzip JS (vs prior 254.18 KB at PR #19 HEAD; +10 KB delta covers the `LineChart` registration in `chartBase.jsx`)
- Analysis (`/analysis.html`): ~271 KB gzip JS (shared chunk + analysis entry chunk)

The shared chunk is served once and cached, so a user visiting both pages pays the shared cost once.

---

## Test plan

- [ ] `cd web && npm install && npm run build` succeeds; both `index.html` and `analysis.html` produced in `../public/`
- [ ] Operator runs `npm run dev` and visually verifies the dashboard renders unchanged from PR #19 deploy
- [ ] Operator navigates to `/analysis.html` in dev and visually verifies all five new charts render
- [ ] Accessibility regression — ECharts `aria` config is on for the analysis page same as the dashboard; the rich-content sections rely on semantic HTML for screen readers (Lede, Methodology). Spot-check with a screen reader if a11y is load-bearing.
- [ ] Codex pre-merge review on PR #21

---

## Notes for future Design Agent rounds

Two operational reminders to fold into the next handoff request so the same scope-creep doesn't recur:

1. **Source baseline.** The redesign branch state changed materially between handoff rounds (Highcharts → ECharts on 2026-05-20). Future archives should be built against the current `main` HEAD, not against the originally-sent state. If unsure which baseline applies, ask before generating.
2. **Public-repo hygiene.** Per `CLAUDE.md` (cache-fix + meter), no literal origin IPs in tracked files including handoff docs. Use `<droplet>` placeholders + "see internal deployment notes" for SSH targets.

— Proxy Builder
