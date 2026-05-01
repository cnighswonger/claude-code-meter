# Session State — claude-code-meter

Last updated: 2026-05-01T00:30Z

## Current Status

- **npm**: `claude-code-meter@0.1.0` published (pending republish under new domain — see Migration below)
- **Server**: `vsits-meter-01` (143.198.28.42:3847), Node 20 + Caddy + systemd
- **Dashboard**: `meter.vsits.co` (index.html + analysis.html). Pre-rebrand `meter.veritassuperaitsolutions.com` still serves the same backend via Caddy `:80 {}` catch-all + Cloudflare proxied DNS, so existing installs keep working until they upgrade.
- **Daily cron**: 06:37 UTC, `analyze --share --yes`, logs to `~/.claude/meter-cron.log`
- **Domain**: Cloudflare proxied; SSL Flexible per-hostname Configuration Rules (`(http.host eq "meter.vsits.co")` and equivalent for the legacy hostname). Zone-wide is Full for WordPress on both zones.

## Migration to meter.vsits.co (2026-05-01)

The corporate domain rebranded from veritassuperaitsolutions.com to vsits.co. Migration scope:

- DNS A record `meter.vsits.co` → 143.198.28.42 in the vsits.co Cloudflare zone (proxied).
- Cloudflare Configuration Rule overriding SSL/TLS mode to **Flexible** for `meter.vsits.co` (matches the existing rule on the old zone). **Gotcha**: matchers must use `http.host` field, not `http.request.full_uri` — the latter includes scheme + path so a wildcard pattern of just the hostname never fires. `(http.host eq "meter.vsits.co")` is the working form.
- Code: `DEFAULT_SERVER`, consent scope, README links, and dashboard HTML company links all swapped to vsits.co. `package.json` author updated. Branch `feat/migrate-to-vsits-co`.
- Caddy required NO changes — `:80 {}` catch-all already accepts every hostname.

## Recent Fix

- **2026-04-18**: Added `claude-opus-4-7` to `KNOWN_RATES` in `src/constants.mjs`. 4.7 was missing, causing `cost_analysis.by_model` to skip all 4.7 calls. Dashboard showed 4.7 as a model category but with zero cost data. Deployed to server, re-ran `analyze --share`. Now showing 1,332 4.7 calls at $131.43 API cost.

## Architecture

- **Interceptor** (`src/interceptor/`): Patches `globalThis.fetch` via `NODE_OPTIONS=--import`. Read-only — captures response headers + usage from SSE stream. Never accesses request bodies.
- **CLI** (`bin/claude-meter.mjs`): status, history, rates (OLS regression), analyze, share
- **Server** (`server/index.mjs`): Community API — accepts analysis submissions, serves dashboard data. Rate limited, anonymous + keyed auth.
- **Dashboard** (`public/`): Highcharts-based. index.html (overview) + analysis.html (deep analysis with model breakdown, cost charts, capacity estimates).

## Critical: Preload is dead on CC v2.1.113+

The `--import` preload mechanism is killed by the Bun binary switch. Migration to proxy architecture tracked at `cnighswonger/claude-code-cache-fix#40` and `cnighswonger/claude-code-meter#2`. Meter capture logic moves into the proxy's response path.

## Pending Tasks

- **Dashboard auto-refresh**: Add setInterval on fetch calls (5-10 min). Chris requested 2026-04-13.
- **Submission dedup**: Use `install_id` (per-install hash in `~/.claude/claude-meter-config.json`) server-side to distinguish unique contributors. Currently overstates contributor count.
- **CLAUDE_METER_SHARE=1 background tier**: Auto-report on session exit. Deferred until Tier 2 (explicit `analyze --share`) is validated.
- **NEXO exporter**: `claude-meter export --format nexo`. Low priority.
- **npm re-publish**: v0.1.2 with dedup + any accumulated fixes.
- **Proxy migration**: Move response-side capture into cache-fix proxy. Blocked by #40.

## Data

- Local JSONL: `~/.claude/claude-meter.jsonl` (~18K+ rows)
- Server dataset: 1 submission (our own), 18K+ calls, 85 sessions
- Models tracked: opus-4-6 (15,018), haiku-4-5 (1,855), opus-4-7 (1,332), sonnet-4-6 (9)
- Model spoofing: none detected across 2,636 checked calls

## Key Design Constraints

- Interceptor NEVER reads request bodies (privacy guarantee)
- `response.clone()` not TransformStream (TransformStream breaks CC's SSE)
- Strict Zod schemas with `z.strictObject()` — no freeform text
- Share payload aggregates to session level — per-turn granularity never leaves machine
- Consent token required on first share (cryptographically bound to install_id)
