# Memo request — meter.vsits.co redesign handoff prep

You are being asked to produce a deployment-context memo. A separate design agent has
produced a new dashboard for `meter.vsits.co` (React + Highcharts, currently a single
HTML file with two `.jsx` scripts transpiled in-browser via Babel). Before that work
can be packaged for deployment, the design agent needs structured information about
how the current site is built, hosted, and served.

Please produce a markdown memo answering every section below. Use the headings as-is
so the design agent can scan it quickly. If a section doesn't apply, say so explicitly
("N/A — site is static, no build step") rather than skipping. Code snippets, file
paths, and exact command names are more useful than prose.

---

## 1. Hosting & runtime

- Where does `meter.vsits.co` run today? (Cloudflare Pages / Workers / Vercel /
  Netlify / a Node or Bun server behind CF / a VPS / something else)
- If it's a server: what process supervises it? (systemd, pm2, docker, …)
- Is the API at `/api/v1/*` served by the same process as the marketing/dashboard
  pages, or by a separate service? If separate, where does the split happen
  (Cloudflare route rules, reverse proxy, …)?
- What region / data centers does it run in?

## 2. Repository

- Single repo or multi-repo? Provide URLs (or paths) for each.
- Specifically: is the dashboard's HTML/CSS/JS source colocated with the
  `claude-code-meter` npm package, or in its own repo?
- Show the top-level directory layout (`ls -la` is fine) plus the contents of any
  `package.json`, `wrangler.toml`, `vercel.json`, `netlify.toml`, `Dockerfile`, or
  similar config files at the repo root.
- Default branch name and protection rules.

## 3. Build pipeline

- Framework, if any (Next.js, Astro, 11ty, SvelteKit, plain HTML, …) and version.
- Exact build command(s) and output directory.
- Dev server command and port.
- Node / Bun / Deno version requirement.
- Lockfile in use (`package-lock.json`, `pnpm-lock.yaml`, `bun.lockb`, …).
- Any pre-commit hooks, linters, formatters, or generated artifacts the agent
  should know about.

## 4. Deploy flow

- How does a change reach production? (git push to main → CI → deploy; manual
  `wrangler deploy`; a button in a dashboard; etc.)
- Provide the CI config file path if any (`.github/workflows/*.yml`, …).
- Are deploys gated on tests, type checks, or manual approval?
- How are previews / staging deployments handled? Is there a staging URL?
- Rollback procedure.

## 5. Routes currently served from `meter.vsits.co`

List every path the public hits. For each, note what serves it.

| Path | Served by | Purpose |
|------|-----------|---------|
| `/`  | …         | Dashboard (the page being redesigned) |
| `/deep-analysis` *(or whatever it's named)* | … | Token capacity & cost model deep dive |
| `/api/v1/dataset` | … | Public dataset |
| `/api/v1/stats`   | … | Aggregate stats |
| `/api/v1/schema`  | … | Accepted submission schema |
| `/api/v1/submit`  | … | Submission endpoint |
| `/api/v1/register`| … | API key registration |
| …    | …         | … |

Include any sitemap, robots, well-known URLs, redirects, or rewrites in use.

## 6. Data the dashboard renders

The redesigned page currently uses hardcoded values lifted from a screenshot. For
production it should pull live values. For **each chart and number** on the current
dashboard, document:

- Source endpoint (e.g. `GET /api/v1/stats`).
- Response shape — paste a real example response, redacting nothing schema-relevant.
- Refresh / cache cadence (every page load? cached for N seconds? server-rendered
  at deploy time? regenerated on submission?).
- Whether any values are computed client-side and which the server precomputes.

If there's an OpenAPI spec, Zod schema export, or TypeScript types file, link it or
paste it.

## 7. Front-end conventions

- CSS approach (vanilla, Tailwind, CSS modules, styled-components, …).
- JS approach for the current page (vanilla, React, Vue, Svelte, htmx, …).
- Bundler/transpiler (esbuild, Vite, Rollup, webpack, none).
- Charting library currently in use, if any (the screenshot looks like Plotly —
  confirm).
- Font hosting (Google Fonts, self-hosted, Bunny, …).
- Whether external CDNs are allowed (`code.highcharts.com`, `fonts.googleapis.com`,
  `unpkg.com`, etc.) or whether everything must be self-hosted / proxied.
- Existing design tokens, color variables, or theme files the redesign should
  align to.

## 8. Brand assets

Provide paths or links to:

- Logo (SVG preferred).
- Favicon set.
- Open Graph / Twitter card image.
- Any existing brand color palette, typography spec, or style guide.
- The "VSITS" mark — is it just text, or is there a glyph?

## 9. Highcharts licensing

The redesign uses Highcharts. Confirm one of:

- [ ] We have a commercial Highcharts license. License key: __________
- [ ] We rely on Highcharts' free use for non-commercial sites and accept the
  watermark / attribution requirement.
- [ ] We do not want to use Highcharts; please switch to a free alternative
  (recommend: ECharts or Observable Plot).

## 10. Performance & SEO targets

- Is server-rendering or static pre-rendering required? (The current Babel-in-browser
  approach is fine for prototypes but slow on first paint.)
- Lighthouse / Core Web Vitals targets you care about.
- Whether SEO matters for this page (it's a dashboard, but the marketing aspects
  might).
- Analytics in use (Plausible, GA, Cloudflare Analytics, none).

## 11. Auth & user-specific state

- Does the dashboard need to display anything user-specific?
- Are write API keys (`POST /api/v1/register`) tied to accounts, or anonymous?
- Any session/cookie behaviour the redesign needs to preserve?

## 12. Things the design agent should NOT change

List anything that's load-bearing and shouldn't be touched — URLs, IDs, ARIA
landmarks the API depends on, CSP rules, event-tracking selectors, etc.

## 13. Constraints / preferences

- Browser support floor (last-2 evergreen? IE11? Safari 14+?).
- Accessibility level required (WCAG 2.1 AA? higher?).
- Any compliance constraints (no third-party analytics, no Google Fonts, etc.).
- Preferred package managers and language conventions (`pnpm`, ESM-only, etc.).

## 14. Open questions / known issues with the current site

Anything you want fixed alongside the redesign, or known footguns the agent
should be aware of.

---

## Format

Return your answer as a single markdown file. Front-matter with `title`, `date`,
and `author` is welcome. Code blocks should be triple-fenced with language hints.
Long config files can be linked or inlined — your call, but bias toward inlining
since the design agent works in a sandboxed environment and can't always reach
out to repos.

When in doubt, over-share. Surplus context is cheap; missing context costs a
round-trip.
