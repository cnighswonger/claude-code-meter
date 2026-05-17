# Handoff: meter.vsits.co dashboard redesign

You are deploying a redesign of the dashboard at `https://meter.vsits.co/`. The
existing site is at `/opt/claude-code-meter/public/index.html` on droplet
`vsits-meter-01` (143.198.28.42). This handoff replaces that page only —
`public/analysis.html`, `public/vendor/*`, and the Node API server are untouched.

The new dashboard is React + Vite + Highcharts, built ahead of time into a static
bundle and dropped into `public/` alongside the existing files. No server code
changes are required.

---

## TL;DR — the deploy

**Companion docs in this folder:**
- `LICENSING.md` — Highcharts decision (read before deploying)
- `DEPLOYMENT_CONTEXT.md` — the operator's memo describing the current production setup, kept for reference
- `MEMO_REQUEST.md` — the questions I asked to produce this handoff; included for audit only

### First time only

```bash
# Locally on the maintainer's machine, before the first deploy:
cp -r handoff/web /opt/claude-code-meter/web    # or via PR
cd /opt/claude-code-meter/web
npm install              # generates web/package-lock.json
git add web/ && git commit -m "add web/ Vite project for dashboard redesign"
git push origin main
```

### Every deploy after that

```bash
ssh root@143.198.28.42
cd /opt/claude-code-meter
git checkout -- package-lock.json          # the known stale-lockfile workaround
git pull --ff-only origin main
cd web
npm ci                                     # fast, exact, reproducible
npm run build                              # writes ../public/index.html + ../public/assets/*
cd ..
systemctl restart claude-meter             # static files don't require this; defensive
curl -s -o /dev/null -w "%{http_code}\n" https://meter.vsits.co/   # → 200
```

**Spot-check in a browser** — open DevTools → Network, confirm:
- `index.html` is the new React shell (the new bundle is named `assets/index-*.js`).
- No requests to `unpkg.com`, `code.highcharts.com`, `fonts.googleapis.com`.
- `/api/v1/stats` and `/api/v1/dataset?limit=1000` both return 200 JSON.
- All 8 Highcharts render.

---

## Decisions you need to make BEFORE deploying

Two open items the deployer must resolve. Both are flagged in `LICENSING.md`; read
it first.

1. **Highcharts license.** Current site uses Highcharts under the free
   non-commercial use terms. This redesign continues that. If `meter.vsits.co` is
   being promoted as a vsits.co product, that license becomes legally shaky. See
   `LICENSING.md` for the swap-to-ECharts path. Don't deploy until the operator
   has decided.

2. **Plan tier for the value-multiplier section.** The dataset row's
   `plan_tier` field is currently `"unknown"` for the only contributor. The
   redesign assumes Max 5x as the observed tier (matches the current live
   dashboard's behavior). If a different tier should be assumed, change
   `OBSERVED_TIER` in `web/src/lib/derive.js`.

---

## File placement

`handoff/web/` is a Vite + React project that mounts into the repo as a
sibling of `public/`, `server/`, and `src/`. Copy it verbatim:

```
/opt/claude-code-meter/
├── bin/                  (existing — untouched)
├── data/                 (existing — untouched)
├── docs/                 (existing — untouched)
├── public/               (existing — index.html will be REPLACED by build)
│   ├── analysis.html     (existing — untouched)
│   └── vendor/           (existing — untouched, analysis.html depends on it)
├── server/               (existing — untouched)
├── src/                  (existing — CLI source, untouched)
├── test/                 (existing — untouched)
├── web/                  ← NEW from handoff/web/
│   ├── package.json
│   ├── vite.config.mjs
│   ├── index.html
│   ├── .gitignore
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── styles.css
│       ├── lib/
│       │   ├── api.js
│       │   ├── derive.js
│       │   └── chartBase.jsx
│       └── components/
│           ├── sections.jsx
│           └── charts.jsx
├── package.json          (existing — see "Optional root script" below)
└── README.md             (existing)
```

The Vite build is configured with `outDir: '../public'` and `emptyOutDir: false`,
so:

- `web/dist/index.html` lands at `public/index.html` (replaces the existing dashboard)
- `web/dist/assets/*` lands at `public/assets/*` (new directory)
- `public/analysis.html` and `public/vendor/*` are not touched by the build

---

## Optional root-level script

Add to the repo root `package.json` `scripts` block so the deploy can run from
the repo root:

```json
"build:web": "cd web && npm ci && npm run build"
```

Then the deploy collapses to:

```bash
cd /opt/claude-code-meter
git checkout -- package-lock.json
git pull --ff-only origin main
npm run build:web
```

---

## What the redesign does

| Section | Source | Rendered with |
|---------|--------|---------------|
| Nav | static | React |
| Lede ("the headline finding") | static editorial copy | React |
| Proof strip ("1 contributor, 47,579 calls, …") | `/api/v1/stats` + dataset reduce | React + animated counters |
| Three Findings cards (145×, 2.4×, 88%) | Derived: deduped dataset rows | React |
| Subscription Value bar chart | `cost_analysis.{total_api_cost, no_cache_cost}` + monthly projection + plan prices | Highcharts (horizontal bar) |
| "What 5× means" multiplier chart | Derived from monthly projection / capacity scaling | Highcharts (bar with baseline plotline) |
| Opus 4.7 advisory | static editorial (until per-visible-token metric is added to the API — see "Open data wiring") | Highcharts (paired column) |
| OLS coefficients | `ols.coefficients.*` averaged across deduped rows | Highcharts (diverging bar) + table |
| Per-model cost | `model_splits.*` + Anthropic published rates | Highcharts (column) |
| Peak vs off-peak | `peak_vs_offpeak.{peak_avg_q5h_per_turn, offpeak_avg_q5h_per_turn}` | Highcharts (paired column) |
| "5× decoded" table | `cost_analysis.total_api_cost`, `exponents.mean`, `fallback_pct`, etc. | React table |
| Cache gauge | `cost_analysis.cache_savings_pct` averaged | Highcharts (solid-gauge) |
| Savings waterfall | `cost_analysis.{no_cache_cost, cache_savings, total_api_cost}` + plan paid | Highcharts (waterfall) |
| Methodology | static editorial + API endpoint list | React |
| Contribute CTA | static (install command block) | React |
| Footer | static + GitHub link | React |

---

## Data wiring

All data comes from two endpoints, fetched in parallel on page load:

```js
const [stats, dataset] = await Promise.all([
  fetch('/api/v1/stats').then(r => r.json()),
  fetch('/api/v1/dataset?limit=1000').then(r => r.json()),
]);
```

The code:
1. Filters `dataset.data` to `type === 'analysis'`.
2. Sorts by `generated_at` descending.
3. Dedups by `install_id` (keep latest per install — matches the current
   dashboard's behavior; see `server/stats-aggregate.mjs` for the canonical
   server-side logic).
4. Computes all chart inputs from the deduped array. Top-line counters come
   from `/api/v1/stats` (`distinct_install_ids`, `total_calls`, `total_sessions`)
   plus dataset reduces (`total_api_cost` sum, cache hit rate mean, etc.).

All wiring lives in `web/src/lib/api.js` (fetch + dedup) and `web/src/lib/derive.js`
(computations). Both are pure functions and unit-testable.

The current API does NOT expose:
- Per-visible-token Q5h cost (needed for the "Opus 4.7 burns at 2.4×" advisory).
  The advisory is currently static editorial copy; the operator can edit the
  number in `web/src/components/sections.jsx → Advisory`. When the API adds a
  per-visible-token metric, swap the static value for the API field.
- Plan tier (`plan_tier` is `"unknown"` for the only current contributor). The
  redesign assumes Max 5x for the multiplier math. Override in
  `web/src/lib/derive.js → OBSERVED_TIER`.
- Subscription paid (no `subscription_cost_paid` field). Computed from observed
  days × monthly plan price; in `derive.js → subscriptionCostPaid`.

---

## Build details

- **Bundler:** Vite 5
- **Output dir:** `../public/` (i.e. `/opt/claude-code-meter/public/`) — same directory the existing static files live in
- **`emptyOutDir: false`** so the build doesn't wipe `analysis.html` or `vendor/`
- **Asset filenames:** `assets/[name]-[hash].js` and `assets/[name]-[hash].css`, content-hashed for cache busting
- **Bundles inline:** Highcharts (core + highcharts-more for waterfall + solid-gauge + annotations + accessibility), React 18
- **Fonts:** system stack only (matches existing convention; no Google Fonts loaded). See "Fonts" below for the optional self-hosted-fonts path.

Total expected gzipped bundle size: ~210 KB JS + ~10 KB CSS. Highcharts core +
highcharts-more (for waterfall) + solid-gauge + accessibility dominate; expect
~190 KB of the JS to be Highcharts. If this is too large, code-split via dynamic
`import()` of the chart components — each chart can be its own chunk loaded
on-demand. Not done by default because the page is single-render and all
charts are visible.

---

## Server: no changes required (with two caveats)

`server/index.mjs` already serves any file from `public/` via its static handler.
The new `public/index.html` and `public/assets/*` are served the same way the old
ones were. The Caddyfile is unchanged.

Two small server-side items worth confirming before or alongside the deploy:

1. **MIME types for fonts.** If you take the optional self-hosted-fonts
   upgrade (`@fontsource/*` packages), Vite will emit `.woff2` and `.woff`
   files into `public/assets/`. Confirm `server/index.mjs`'s `MIME_TYPES` table
   includes:
   ```js
   '.woff2': 'font/woff2',
   '.woff':  'font/woff',
   ```
   Without these, the browser falls back to `application/octet-stream` and
   most browsers still load the font correctly, but some accessibility tools
   and older browsers complain. Skip this step entirely if fonts stay off.

2. **CORS on `/api/v1/stats`.** The dev server proxies `/api` to
   `https://meter.vsits.co`. The dashboard fetches both `/api/v1/dataset`
   (confirmed `Access-Control-Allow-Origin: *`) and `/api/v1/stats`. If
   `/api/v1/stats` doesn't currently set the same header, `npm run dev` will
   work (Vite's proxy handles it) but external dashboards reading
   `/api/v1/stats` from a different origin won't. Adding the header to
   `/api/v1/stats` for symmetry with `/dataset` is a one-line change in
   `server/index.mjs` and worth doing.

If the static handler is path-prefix-strict (it probably is, given the current
shape), confirm it serves `/assets/*` from `public/assets/`. If not, a one-line
addition to the static route in `server/index.mjs` will be needed; flag back if
this is the case.

---

## Fonts

The dashboard uses the system font stack by default — matching the existing
site's "no Google Fonts" rule. Stack:

```css
font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
font-family: ui-monospace, "SF Mono", Menlo, monospace;          /* numbers */
font-family: ui-serif, Georgia, "Times New Roman", serif;        /* italic accents */
```

**Optional upgrade — self-hosted editorial fonts.** The original design used Geist,
JetBrains Mono, and Newsreader. To enable:

```bash
cd web
npm install @fontsource/geist @fontsource/jetbrains-mono @fontsource/newsreader
```

Then in `web/src/main.jsx`, uncomment the three `@fontsource/*` imports and the
`--f-sans`, `--f-mono`, `--f-serif` overrides in `web/src/styles.css`. Self-hosted,
no CDN, satisfies the "no Google Fonts" constraint.

---

## Rollback

```bash
ssh root@143.198.28.42
cd /opt/claude-code-meter
git checkout -- package-lock.json
git reset --hard <previous-commit-sha>
# No need to rebuild — the old public/index.html is now in place.
systemctl restart claude-meter
```

If only the dashboard needs rolling back (not the API), checkout the previous
`public/index.html` specifically:

```bash
git checkout <previous-commit-sha> -- public/index.html public/assets
```

---

## Verifying the deploy

After `npm run build` succeeds and the page is live:

1. `curl -s https://meter.vsits.co/ | head -20` — should return a doctype and the React app shell.
2. Browser-load `https://meter.vsits.co/`. Open DevTools → Network.
3. Confirm:
   - `index.html` → 200, ~6 KB
   - `assets/*.js` → 200, ~150 KB gzipped
   - `assets/*.css` → 200, ~10 KB gzipped
   - `/api/v1/stats` → 200, JSON
   - `/api/v1/dataset?limit=1000` → 200, JSON
   - **No requests to unpkg.com, code.highcharts.com, fonts.googleapis.com.**
4. All 8 Highcharts render: subscription value bars, multiplier chart, OLS
   diverging bar, per-model column, peak/off-peak column, Opus 4.7 paired
   column, cache solid-gauge at the observed cache hit rate %, savings waterfall.
5. Animated counters in the proof strip count up on load.
6. Page passes a quick Lighthouse pass — LCP under 2s, no render-blocking
   third-party JS.

---

## Known follow-ups (not blockers)

1. **Per-visible-token Q5h cost endpoint.** The Opus 4.7 advisory currently shows
   static numbers from the original screenshot ("2.4×"). When the API adds a
   `per_visible_token_q5h` field to the analysis row schema, swap the static
   values in `Advisory.jsx` for the API value.
2. **`plan_tier` field.** Once contributors are submitting with a known tier,
   remove the `OBSERVED_TIER` override and use `dataset[0].plan_tier` directly.
3. **`analysis.html`.** The Deep Analysis page is out of scope for this
   redesign. If/when it's redesigned, the same Vite project gains a second entry
   (multi-page mode in `vite.config.mjs`) — straightforward to add.
4. **Staging.** Memo §14 noted no staging environment. The build can be smoke-tested
   locally with `npm run dev` (Vite dev server hits production's `/api/v1/*` via
   the dev proxy in `vite.config.mjs`). For real staging, a `meter-staging.vsits.co`
   subdomain pointed at the same droplet on a second port is the cheapest path.

---

## Contact / questions

If anything's unclear, surface back before merging. Things worth double-checking
before deploy:
- Is the server's static handler happy serving from `public/assets/`?
- Are the four "Findings card" values still correct after dedup (145×, 2.4×, 88%)?
- Does the redesign render correctly at the current dataset size (1 contributor)
  AND at a hypothetical 50-contributor size?

— Design Agent
