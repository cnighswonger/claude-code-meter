---
title: meter.vsits.co — deployment context for redesign handoff
date: 2026-05-16
author: Proxy Builder (cache-fix-proxy + claude-code-meter maintainer)
---

# Deployment context: meter.vsits.co

Companion memo to `claude-design-meter-site-request.md`. Headings match the request 1-to-1.

Quick TL;DR before the sections:

- **No build pipeline, no React.** The current site is plain HTML + vanilla JS + locally-vendored Highcharts, served as static files by the same Node process that serves the JSON API.
- **One VPS, one process.** Single Node `http` server on a DigitalOcean droplet, supervised by systemd, fronted by Caddy on :80 with Cloudflare in front (proxied, SSL Flexible per-hostname).
- **Manual deploy.** `git pull && systemctl restart` on the server. No CI, no protections on `main`. Same maintainer for code and ops.
- **Highcharts is self-vendored** (the JS files live in `public/vendor/`). Not Plotly — the request memo guessed Plotly from the screenshot; the actual library is Highcharts.

Most relevant implication for the redesign: introducing React + JSX-via-Babel-in-browser is fine for prototyping but should be replaced with a real build step (Vite or esbuild) before production. The current `server/index.mjs` serves any file from `public/`, so once the React app is built it can drop into `public/` exactly like the current files do — no infrastructure change beyond adding a build step somewhere in the deploy flow.

---

## 1. Hosting & runtime

- **Where:** A single DigitalOcean droplet, `vsits-meter-01` (143.198.28.42). Not Pages / Workers / Vercel / Netlify.
- **Region:** DigitalOcean NYC (confirmed by IP). Single region; no CDN origin redundancy.
- **OS:** Ubuntu LTS, Node.js 20 (system-installed).
- **Supervisor:** systemd unit `claude-meter.service`. Runs as user `nobody`, group `nogroup`, `Restart=on-failure`. Unit file verbatim:
  ```ini
  [Unit]
  Description=claude-code-meter community API server
  After=network.target

  [Service]
  Type=simple
  User=nobody
  Group=nogroup
  WorkingDirectory=/opt/claude-code-meter
  ExecStart=/usr/bin/node server/index.mjs
  Restart=on-failure
  RestartSec=5
  Environment=PORT=3847
  Environment=DATA_DIR=/opt/claude-code-meter/data
  StandardOutput=journal
  StandardError=journal

  [Install]
  WantedBy=multi-user.target
  ```
- **Front door:** Caddy on :80 (no TLS terminated at the box — Cloudflare terminates TLS and proxies). Caddy reverse-proxies to `localhost:3847`. Caddyfile verbatim:
  ```caddy
  :80 {
      reverse_proxy localhost:3847

      header Cache-Control "no-store, no-cache"
      header X-Content-Type-Options "nosniff"
      header X-Frame-Options "DENY"
      header Referrer-Policy "no-referrer"

      request_body {
          max_size 64KB
      }

      log {
          output file /var/log/caddy/access.log {
              roll_size 10MB
              roll_keep 5
          }
      }
  }
  ```
  The Caddyfile is a `:80 {}` catch-all, which means **any hostname pointed at the droplet's port 80 is served by this site**. The legacy hostname `meter.veritassuperaitsolutions.com` and the current `meter.vsits.co` both hit it.
- **Cloudflare:** proxied DNS (orange-cloud) on `meter.vsits.co` → 143.198.28.42. Cloudflare Configuration Rule: SSL/TLS mode **Flexible** for `meter.vsits.co` (zone-wide is Full to keep the WordPress site happy). The matcher field is `http.host` (not `http.request.full_uri`). Same setup exists in the legacy `veritassuperaitsolutions.com` zone for back-compat.
- **API + pages share one process.** Both the dashboard HTML and the JSON API are served by the same `node server/index.mjs` process. No split, no separate API host.
- **Other services on the same box:** a Python `uvicorn` listening on `127.0.0.1:9090` for `kanfei-sensor.vsits.co` (separate Caddy block, separate app). Unrelated to the meter site but flagged so the design agent doesn't think there's a redundant API surface to worry about.

## 2. Repository

- **Single repo.** `https://github.com/cnighswonger/claude-code-meter`. The dashboard HTML/CSS/JS lives in this same repo, NOT a separate web repo.
- **Default branch:** `main`. **No branch protection rules.** Direct pushes by maintainers + bot identities are allowed; the convention is feature-branch + PR, not enforced by GitHub.
- **Top-level layout** (working tree, excluding `node_modules`):
  ```
  bin/                # CLI entry point (claude-meter)
  CHANGELOG.md
  .claude/
  CLAUDE.md           # agent-facing repo conventions
  data/               # local-only data dir (not the prod data dir)
  docs/
  .github/FUNDING.yml # only file in .github; no workflows
  .gitignore
  LICENSE             # MIT
  package.json
  package-lock.json
  public/             # ★ the static site (the thing being redesigned)
  README.md
  server/             # the Node API server
  SESSION_STATE.md    # agent-facing operational state
  src/                # CLI implementation modules
  test/               # Node :test runner unit tests
  ```
- **`public/` (current dashboard, the thing being redesigned):**
  ```
  public/index.html       # main dashboard
  public/analysis.html    # "Deep Analysis" page
  public/vendor/
    bullet.js
    highcharts.js
    highcharts-more.js
    solid-gauge.js
  ```
- **`package.json` verbatim:**
  ```json
  {
    "name": "claude-code-meter",
    "version": "0.6.1",
    "description": "Community usage metrics collector for Claude Code — anonymized billing analysis and cost modeling",
    "type": "module",
    "bin": {
      "claude-meter": "bin/claude-meter.mjs"
    },
    "files": ["bin/", "src/", "public/"],
    "scripts": {
      "start:server": "node server/index.mjs",
      "test": "node --test test/*.test.mjs"
    },
    "funding": { "type": "individual", "url": "https://buymeacoffee.com/vsits" },
    "dependencies": { "zod": "^3.23.0" },
    "devDependencies": {},
    "engines": { "node": ">=18.0.0" },
    "license": "MIT",
    "repository": { "type": "git", "url": "git+https://github.com/cnighswonger/claude-code-meter.git" },
    "author": "Chris Nighswonger <dev@vsits.co> (https://vsits.co)"
  }
  ```
- **No `wrangler.toml`, `vercel.json`, `netlify.toml`, `Dockerfile`** — none of those apply. The deployment is a plain VPS.

## 3. Build pipeline

**N/A — there is no build step today.** The HTML is hand-written, the JS is vanilla, Highcharts is pre-downloaded into `public/vendor/`. Everything in `public/` is served as-is.

- **Framework:** none. Vanilla HTML + ES2020 JS.
- **Build command:** none. `git pull` puts the source files in place; the Node server serves them directly.
- **Output directory:** `public/` is both source and served. If the redesign introduces a build step, the convention should be `public/dist/` (or similar) with the build artifacts, and the Node server's static-file route gets pointed at the build output instead of the source.
- **Dev server:** `npm run start:server` runs the production server (`node server/index.mjs`) on `PORT` (env, default 3847). There is no separate dev server with hot reload — local development is "edit the file, refresh the browser."
- **Node version:** `>=18.0.0` declared in `engines`; production runs 20 LTS. The server uses ESM (`"type": "module"`) and Node's built-in `http`/`fs`/`crypto`.
- **Lockfile:** `package-lock.json` (npm).
- **Pre-commit hooks:** none in the repo.
- **Linters/formatters:** none configured in the repo. The codebase uses Prettier-ish defaults but it's not enforced.
- **Generated artifacts:** none today.

## 4. Deploy flow

- **How changes reach production:**
  1. Merge PR into `main` on GitHub.
  2. SSH to `root@143.198.28.42`.
  3. `cd /opt/claude-code-meter && git pull --ff-only origin main`
  4. `systemctl restart claude-meter`
  5. Spot-check `/api/v1/stats` and the rendered dashboard.

  Same maintainer holds both the merge button and the SSH key. This is intentional at current scale; the deploy is the merge.
- **Local-mod note:** the production checkout's `package-lock.json` shows as locally modified on every `git status` because `npm install` regenerates a field the committed lockfile lacks (the rename from `@claude-meter/collector` → `claude-code-meter` left a stale name field). The deploy step `git checkout -- package-lock.json` before `git pull --ff-only` is part of the routine. Known issue, tracked in `SESSION_STATE.md`.
- **CI:** **None.** `.github/` contains only `FUNDING.yml`. No workflow files, no required checks, no protected branch. Tests (`npm test`, Node's built-in `--test`) are run locally before merging; the discipline is human, not enforced.
- **Tests:** `npm test` runs the Node `:test` suite in `test/*.test.mjs`. 55 tests as of v0.6.1. **No coverage gate, no type-check gate.** They're a local correctness check, not a release gate.
- **Previews / staging:** **None.** No staging URL, no preview environments. Every change goes straight from PR merge to production via the manual deploy step above.
- **Rollback:** `git checkout <previous-commit> && systemctl restart claude-meter`. Data is JSONL on disk in `/opt/claude-code-meter/data/`, which doesn't roll back with the code — but the data format is forward-compatible by design (strict Zod schema rejects unknown keys; bumps require version bumps).

## 5. Routes currently served from `meter.vsits.co`

All paths are served by **one** Node process (`server/index.mjs`) behind Caddy. The routing logic is in `server/index.mjs:200-360` (approximate).

| Path | Method | Served by | Purpose |
|------|--------|-----------|---------|
| `/` | GET | `server/index.mjs` static handler → `public/index.html` | Main dashboard |
| `/analysis.html` | GET | static → `public/analysis.html` | Deep analysis page (cost model, model breakdown, capacity estimates) |
| `/vendor/*` | GET | static → `public/vendor/*` | Highcharts JS bundles |
| `/api/v1/stats` | GET | inline handler | Aggregate stats — top-line cards source |
| `/api/v1/dataset` | GET | inline handler | Public dataset (JSON or CSV, `?limit=N`, `?after=YYYY-MM-DD`, `?model=...`) |
| `/api/v1/schema` | GET | inline handler | Accepted submission schema field list |
| `/api/v1/submit` | POST | inline handler | Submission endpoint (anon or API-keyed) |
| `/api/v1/register` | POST | inline handler | API key registration (rate-limited) |

- **No sitemap, no robots.txt, no `/.well-known`.** The dashboard is a single-purpose API endpoint with an HTML viewer; SEO isn't a goal today.
- **No redirects or rewrites.** The Caddyfile is a single `reverse_proxy` block — no rewrite rules; the Node server doesn't redirect either.
- **OPTIONS (CORS preflight):** the Node server handles `OPTIONS` for the API endpoints with permissive CORS. `Access-Control-Allow-Origin: *` is set on `/api/v1/dataset` responses (intentional — third-party dashboards consume this as a raw row feed). The other API endpoints set CORS as appropriate.

## 6. Data the dashboard renders

The current dashboard does **two `fetch()` calls on page load**, both with no caching:

```js
// public/index.html — loadDashboard()
const [statsRes, dataRes] = await Promise.all([
  fetch('/api/v1/stats'),
  fetch('/api/v1/dataset?limit=1000'),
]);
```

There is also a duplicate fetch inside `renderStatsRow()` (legacy from when the cards function was separable). Both endpoints set `Cache-Control: no-store, no-cache` at the Caddy layer.

Refresh cadence: **every page load.** No client-side polling, no SSE, no auto-refresh. Reload the page to see new data.

### Chart-by-chart sourcing (current `index.html`)

The dashboard filters `dataset.data` to `type === 'analysis'` rows, dedups by `install_id` (last-wins per install — see PR #14/#15/#16/#18 lineage in the changelog), and feeds the deduped array into the chart functions.

| Card / chart | Source | Computed where |
|--------------|--------|----------------|
| **Contributors** card | `stats.distinct_install_ids` (server-precomputed) | Server (`computeStatsAggregate`) |
| **Analysis Reports** card | Raw count of `dataset.data.filter(d => d.type === 'analysis')` | Client |
| **Total API Calls** card | Sum of `n_calls` over deduped analyses | Client |
| **Total Sessions** card | Sum of `n_sessions` over deduped analyses | Client |
| **Subscription Value** bar chart | `cost_analysis.total_api_cost`, `no_cache_cost`, `cache_savings`, monthly projection from `data_range` span | Client |
| **Model Fit (R²)** column chart | `ols.r_squared` per submission | Client |
| **Cost Accumulation Exponent** bar chart | `exponents.mean`, `exponents.median` per submission | Client |
| **OLS Coefficients** column chart | `ols.coefficients.avg_output / avg_cache_creation / avg_cache_read / avg_input` per submission | Client |
| **Feature Correlations with Q5h Drain** bar chart | `correlations.{avg_output, avg_cache_creation, avg_cache_read, avg_input}`, averaged across submissions | Client |

### Endpoint response shapes

**`GET /api/v1/stats`** — live shape (HEAD `f5059bd`, captured 2026-05-16):

```json
{
  "total_submissions": 2,
  "submissions_by_type": { "share": 0, "analysis": 2 },
  "distinct_install_ids": 1,
  "total_calls": 47579,
  "total_turns": 47579,
  "total_sessions": 188,
  "models": {
    "claude-opus-4-6": 20064,
    "claude-haiku-4-5": 2748,
    "claude-sonnet-4-6": 37,
    "claude-opus-4-7": 24640,
    "claude-opus-4": 90
  },
  "earliest": "2026-04-30T06:37:02.473Z",
  "latest":   "2026-05-16T13:25:01.446Z"
}
```

- `total_submissions` and `submissions_by_type` are **raw row counts** (no dedup). `distinct_install_ids`, `total_calls`, `total_sessions`, `models` reflect the **deduped-by-install_id** view (latest snapshot per install wins). `earliest` and `latest` reflect the **full submission history** (raw, no dedup). This split is intentional — see commits `427926d` (dedup), `7e765fc` (distinct_install_ids), `54fa6d8` (earliest/latest from raw rows) for the why.
- `total_turns` is a back-compat alias for `total_calls`.
- The aggregator is at `server/stats-aggregate.mjs`, pure function, fully covered by `test/stats-aggregate.test.mjs` (55 tests).

**`GET /api/v1/dataset?limit=1000`** — paginated row feed. Real example response (one row, abbreviated):

```json
{
  "count": 1,
  "total": 2,
  "data": [
    {
      "type": "analysis",
      "auth": "anon",
      "v": 1,
      "generated_at": "2026-05-16T13:25:01.446Z",
      "install_id": "39b82237b25bbfc7",
      "data_range": {
        "start": "2026-04-04T19:05:18.878Z",
        "end":   "2026-05-16T13:20:08.045Z"
      },
      "plan_tier": "unknown",
      "billing_type": "subscription",
      "fallback_pct": 0.5,
      "n_sessions": 188,
      "n_calls": 47579,
      "n_drain_events": 134,
      "n_rejected": 111,
      "ols": {
        "r_squared": 0.0686,
        "coefficients": {
          "intercept": 0.0044966,
          "avg_output": 4.6006e-07,
          "avg_input": -5.0137e-07,
          "avg_cache_creation": 1.2701e-08,
          "avg_cache_read": -6.6724e-09
        }
      },
      "correlations": {
        "avg_output": 0.0126,
        "avg_input": 0.028,
        "avg_cache_creation": 0.0634,
        "avg_cache_read": -0.2568
      },
      "exponents": {
        "mean": 0.7871,
        "median": 0.7894,
        "std": 0.4558,
        "n_superlinear": 16,
        "n_total": 133
      },
      "peak_vs_offpeak": {
        "peak_avg_q5h_per_turn": 0.003822,
        "offpeak_avg_q5h_per_turn": 0.002786
      },
      "model_splits": {
        "claude-opus-4-6": { "n_calls": 20064, "avg_q5h_per_turn": 0.003823 },
        "claude-haiku-4-5": { "n_calls": 2748, "avg_q5h_per_turn": 0.000935 },
        "claude-sonnet-4-6": { "n_calls": 37, "avg_q5h_per_turn": 0.001351 },
        "claude-opus-4-7": { "n_calls": 24640, "avg_q5h_per_turn": 0.000677 },
        "claude-opus-4": { "n_calls": 90, "avg_q5h_per_turn": 0 }
      },
      "cost_analysis": {
        "total_api_cost": 10097.7453,
        "no_cache_cost":  84548.3229,
        "cache_savings":  74450.5777,
        "cache_savings_pct": 88.1,
        "by_model": {
          "claude-opus-4-6": { "cost": 3230.2587, "calls": 20064 },
          "claude-haiku-4-5": { "cost": 28.1515, "calls": 2748 },
          "claude-sonnet-4-6": { "cost": 8.5043, "calls": 37 },
          "claude-opus-4-7": { "cost": 6830.8308, "calls": 24640 }
        },
        "rates_verified": "2026-04-14",
        "rates_source": "https://platform.claude.com/docs/en/docs/about-claude/pricing",
        "disclaimer": "Estimates based on published API rates. Subscription billing may differ. Verify at source URL."
      },
      "model_spoofing": { "status": "none_detected", "checked": 31694 }
    }
  ]
}
```

Two row `type`s coexist in the dataset:
- `type: "analysis"` — cumulative snapshot rows from `claude-meter analyze --share`. The fields above. **Used by the dashboard.**
- `type: "session"` (legacy "share") — per-session aggregate rows. Smaller shape (model, turn_count, date, plan_tier, token totals). The dashboard ignores these via `.filter(d => d.type === 'analysis')`.

Submission types coexist intentionally. The dedup-by-install_id rule applies **only to `analysis` rows** — share rows are incremental and must stay summed. See `server/stats-aggregate.mjs` for the canonical aggregator.

**`GET /api/v1/schema`** — accepted submission field list:

```json
{
  "version": 1,
  "description": "claude-meter share payload schema",
  "fields": [
    "v", "date", "model", "speed", "turn_count", "plan_tier",
    "total_input_tokens", "total_output_tokens",
    "total_cache_creation_tokens", "total_cache_read_tokens",
    "total_ephemeral_1h_tokens", "total_ephemeral_5m_tokens",
    "total_web_search_requests", "avg_cache_hit_rate",
    "q5h_start", "q5h_end", "q7d_start", "q7d_end",
    "q5h_total_delta", "q7d_total_delta"
  ]
}
```

(Note: this lists fields for the legacy `share` payload. The newer `analysis` submissions follow a richer schema defined in `claude-code-meter`'s `src/log/schema.mjs` but not exposed via `/api/v1/schema` today. The dashboard doesn't consume `/api/v1/schema` itself; it's there for API users submitting data.)

**Schemas — canonical source.** Both `SharePayloadSchema` and the `analysis` submission schema are Zod (`z.strictObject({ ... })`) and live in `src/log/schema.mjs` in this repo. **No TypeScript types file**, **no OpenAPI spec.** The Zod schemas are the contract. If the redesign needs typed clients, generating types from the Zod schemas (`zod-to-ts`, `zod-to-openapi`) is the cleanest path.

## 7. Front-end conventions

- **CSS:** vanilla, inline in `<style>` block at the top of each HTML file. No Tailwind, no CSS modules, no preprocessor. Existing palette:
  - Background: `#0f172a` (slate-950-ish)
  - Card background: `#1e293b` (slate-800)
  - Card border: `#334155` (slate-700)
  - Primary text: `#e2e8f0` (slate-200)
  - Subtitle / dim text: `#94a3b8` (slate-400)
  - Headings: `#f8fafc` (slate-50)
  - Accent / chart primary: `#60a5fa` (blue-400)
  - Series colors (Highcharts override): `['#60a5fa', '#34d399', '#f59e0b', '#f87171', '#a78bfa', '#fb923c']` (blue / emerald / amber / red / violet / orange — Tailwind 400-band)
  - Border radius on cards: `12px`
  - Border radius on chart bars: `4px`
- **JS:** vanilla ES2020 in `<script>` blocks. No React, no Vue, no Svelte, no htmx. Two HTML files (`index.html` and `analysis.html`) each have their own copy of the page logic — minor duplication today, intentional given the tiny scope.
- **Bundler / transpiler:** **none.** Browsers execute the JS directly.
- **Charting library:** **Highcharts** (NOT Plotly — the screenshot you saw is Highcharts in its dark theme). Specifically: Highcharts core + highcharts-more + solid-gauge + bullet, all **self-vendored** in `public/vendor/`. No CDN fetches.
- **Fonts:** system stack only — `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`. No Google Fonts, no self-hosted custom fonts, no font CDNs.
- **External CDNs in use today:** exactly one — `https://cdn.buymeacoffee.com/buttons/bmc-new-btn-logo.svg` (the "buy me a coffee" badge). Everything else (Highcharts, fonts) is local. The redesign should preserve the no-CDN-for-critical-path posture — third-party CDN failures can't break the dashboard.
- **Design tokens / theme file:** none. The palette above is hard-coded in each HTML file's `<style>` block. If the redesign introduces tokens, the natural home is a `public/theme.css` or `public/tokens.css` referenced by both pages.

## 8. Brand assets

- **Logo:** **none today.** The page header is text-only — "Claude Code Meter — Community Cost Analytics" in the system-font stack. If a logo is needed, it doesn't exist yet; design agent can propose one or run without.
- **Favicon:** **not set.** The HTML has no `<link rel="icon">`. Browsers fall back to default.
- **Open Graph / Twitter card image:** **none.** No `og:` meta tags in the current HTML.
- **Brand color palette / typography spec:** see §7 — the live colors and system-font stack are the de-facto spec. Nothing more formal exists.
- **"VSITS" mark:** the parent company is "Veritas Supera IT Solutions LLC" → "VSITS" as a text mark. **No glyph.** The site's link to https://vsits.co is text-only. The marketing site (https://vsits.co) is a separate WordPress install on a different host; its branding is text-based as well.

If the redesign would benefit from any of the above (favicon, OG card, glyph), call it out and we'll generate them — but they're not blockers.

## 9. Highcharts licensing

[x] We rely on Highcharts' free use for non-commercial sites and accept the watermark / attribution requirement.
[ ] We have a commercial Highcharts license.
[ ] We do not want to use Highcharts.

**Current status:** the live site uses Highcharts under the non-commercial/personal license (no commercial key configured, no watermark visible in screenshots because we're below the dashboard threshold and Highcharts doesn't watermark personal use).

**Important question for the redesign:** if `meter.vsits.co` is going to be promoted more publicly or marketed as a vsits.co product surface, the non-commercial license becomes legally shaky — Highcharts' license terms restrict commercial use without a paid key. Two options the design agent should surface:
1. Confirm with the operator whether a commercial license is in budget. If yes, the redesign continues with Highcharts.
2. If no, recommend ECharts (Apache 2.0) or Observable Plot (ISC) as drop-in replacements. ECharts is the closer match feature-wise; Plot is more declarative and friendlier to React but has less out-of-the-box chart variety.

Don't assume either path — flag the decision back to the operator.

## 10. Performance & SEO targets

- **Server-rendering or static pre-rendering required?** Not required today, but **strongly preferred** for the redesign. The current `fetch('/api/v1/stats')` + `fetch('/api/v1/dataset?limit=1000')` on every page load is fine but adds ~1 RTT to first paint. If the redesign pre-renders the stats card values at deploy time (or server-renders on first request and caches for N seconds), the dashboard feels instant.
- **Lighthouse / CWV:** no formal targets. The current site is fast enough on broadband — sub-second first paint, no JS-frame thrash. Don't regress: LCP under 2s, no large render-blocking resources, no third-party JS in the critical path.
- **SEO:** **low priority.** The dashboard is a single-page operational view, not a marketing surface. Title + meta description are fine; Open Graph card would be a nice-to-have for social previews when shared in chat, but not a deploy gate.
- **Analytics:** **none today.** No Plausible, no GA, no Cloudflare Analytics enabled. Cloudflare's free-tier "Web Analytics" could be turned on if anyone wants traffic visibility (cookieless, GDPR-friendly), but right now we have zero analytics by design.

## 11. Auth & user-specific state

- **Dashboard reads:** **no auth required, no user-specific state.** Every visitor sees the same aggregate data. No login, no cookies, no localStorage state that affects rendering.
- **Write API keys:** `POST /api/v1/register` issues anonymous API keys (rate-limited). Submissions via `POST /api/v1/submit` accept both anonymous and keyed callers; the `auth` field on the stored row records which path it came in via (`"anon"` or `"key"`). Keys are **not tied to user accounts** — there's no user concept on the site. The keys exist solely to attribute submissions in the local store and to give submitters a stable identity if they want one.
- **Sessions / cookies:** none. Caddy adds no cookies; the Node server adds none. The redesign should keep this property — anything that introduces a cookie or login flow is a meaningful product decision, not a redesign detail.

## 12. Things the design agent should NOT change

- **API endpoint paths.** `/api/v1/*` is the public contract. Third-party dashboards (notably `fgrosswig/claude-usage-dashboard`) consume `/api/v1/dataset` and `/api/v1/stats`. Renaming any of those is a breaking change.
- **`/api/v1/dataset` response shape — specifically, that it's a raw row feed, not a deduped aggregate.** Multiple downstream consumers do their own analysis on raw rows. The dashboard intentionally keeps the endpoint raw and dedups client-side (see `public/analysis.html:128` for the original pattern; `index.html` mirrors it post PR #14/#16). The redesign can continue this pattern; do not change the endpoint contract.
- **CORS on `/api/v1/dataset`.** `Access-Control-Allow-Origin: *` is intentional — external dashboards need to fetch this from their own origins.
- **`type` field semantics in submitted rows.** Two types coexist (`"analysis"` for cumulative snapshots, `"session"` for legacy share rows). The dedup rule is **type-scoped** (analysis only). Don't conflate them in the redesign.
- **Caddy headers.** `Cache-Control: no-store, no-cache`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` are all set at the proxy layer and apply to both static assets and API responses. Keep behavior consistent — don't introduce caching of dynamic data without an explicit decision.
- **Cloudflare Configuration Rule for `meter.vsits.co`** (SSL Flexible mode keyed on `http.host`). Don't touch the CF config from the redesign side.
- **`buymeacoffee.com` link in the footer.** Funding link; intentional.
- **Anonymized-data guarantee.** The README and dashboard footer both state that submissions are anonymized. The data shape preserves this (no IP, no email, install_id is a random hash). If the redesign would surface anything that could de-anonymize contributors, flag it instead of shipping it.

## 13. Constraints / preferences

- **Browser support:** last-2 evergreen (Chrome / Edge / Firefox / Safari). No IE11. Safari 14+ is the floor. The current site uses ES2020+ syntax and modern Highcharts; the redesign can assume the same.
- **Accessibility:** no formal WCAG target today, but the redesign should at least clear WCAG 2.1 AA basics — semantic landmarks, alt text, keyboard navigation through the chart grid, contrast ratios that survive the dark theme. The current site doesn't audit well; better is welcome.
- **Compliance:**
  - **No third-party analytics** (status quo).
  - **No Google Fonts** (system stack is fine; if a custom font is required, self-host).
  - **No third-party CDN for critical path** (Highcharts must remain self-vendored or be replaced; same rule applies to React if introduced).
- **Package manager:** **npm** for this repo (matches `package-lock.json`). Bun / pnpm not used. ESM-only (`"type": "module"`).
- **Code style:** prefer ESM imports, `const` over `let`, prefer functions over classes for state, avoid `any` types if TS is introduced. Match the existing `server/` and `src/` patterns.

## 14. Open questions / known issues with the current site

In rough priority order:

1. **The "Contributors / Analysis Reports / Total API Calls / Total Sessions" card semantics are very recent** — PRs #14, #15, #16, #18 (all merged today, 2026-05-16). The dedup-by-install_id story plus the `earliest`/`latest` from raw rows split is fresh. If the design agent saw earlier behavior in a screenshot or cached version, treat the current `/api/v1/stats` shape as ground truth — not whatever was visible last week.

2. **Two HTML files duplicate data-fetch and dedup logic.** `index.html` and `analysis.html` each fetch `/api/v1/dataset?limit=N` and apply the install_id dedup pattern client-side. The redesign should factor this into a shared utility (one fetcher, one dedup helper, both consumed by both pages). The duplication today is intentional simplicity, not a defended design choice — happy to lose it.

3. **Babel-in-browser is not the production path.** The redesign currently uses `@babel/standalone` to transpile JSX in the browser. That's fine for prototyping; it's slow on first paint (Babel itself is ~600 KB gzipped) and burns CPU on every page load. The production deploy should pre-build the JSX into vanilla JS via Vite or esbuild and serve the built output. Vite is the lower-friction choice — `npm run build` produces `dist/`, point the Node server at `dist/` instead of `public/` (or copy `dist/*` to `public/` as a deploy step). Either way, no Babel-in-browser in production.

4. **Highcharts version drift.** The vendored files in `public/vendor/` were downloaded once in April 2026 and haven't been refreshed. If the redesign needs newer chart types or bug fixes, the vendored files need to be re-downloaded from highcharts.com. (Or — see §9 — swap to ECharts/Plot and skip the vendoring entirely.)

5. **No favicon, no OG card.** Mentioned in §8. Small but visible — every browser tab shows a generic globe icon, every link share gets no preview. Easy win for the redesign to include.

6. **`/api/v1/schema` only documents the legacy share payload, not the analysis schema.** Submitters of `analysis`-type rows have to read the Zod source in `src/log/schema.mjs` to know what to send. If the redesign surfaces a "submit your own data" flow, this gap needs to close — generate the analysis schema from Zod and expose it at `/api/v1/schema?type=analysis` or similar.

7. **No staging environment.** Every redesign iteration that wants to be tested against real data has to either run locally against production's `/api/v1/*` (fine for read-only) or get deployed to production. If the redesign warrants a staging URL, the simplest path is `meter-staging.vsits.co` pointed at a second port on the same droplet, or at a separate small droplet. Easy to spin up — flag if needed.

8. **The data set is tiny.** At time of writing, the dataset has **two analysis submissions from one contributor** (us). All charts are technically working but visually sparse. Don't design for empty state alone — design assuming 10x or 100x growth is achievable; the layout should still read well with 50 contributors.

---

## Format

This memo is self-contained — no links it depends on. Config files (Caddyfile, systemd unit, `package.json`, response shapes) are inlined. The repo URL is `https://github.com/cnighswonger/claude-code-meter` if the design agent wants to browse, but everything load-bearing is captured above.

If anything's missing or unclear, ping back with specific questions — happy to surface live response shapes for additional endpoints, run probes against the live site, or capture any other diagnostic you need.

— Proxy Builder
