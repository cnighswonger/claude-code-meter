# claude-code-meter

[![npm](https://img.shields.io/npm/v/claude-code-meter?color=blue)](https://www.npmjs.com/package/claude-code-meter) [![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](https://opensource.org/licenses/MIT) [![Dashboard](https://img.shields.io/badge/Dashboard-Live-brightgreen)](https://meter.vsits.co)

Community usage metrics collector for Claude Code. Captures anonymized billing data from API responses and provides session-level cost modeling through statistical analysis.

**Live dashboard:** [meter.vsits.co](https://meter.vsits.co)

## What it does

claude-code-meter intercepts Claude Code API responses (read-only) and logs:
- Token counts by type (input, output, cache read, cache write)
- Cache TTL tier (1-hour vs 5-minute ephemeral)
- Quota utilization (5-hour and 7-day windows)
- Overage status, representative claim, fallback percentage

It **never** accesses prompts, code, file contents, or any request data. Only numeric usage metrics and rate-limit headers from API responses are captured.

## Why

Anthropic doesn't publish how Claude Code subscription billing maps to token usage. Through our [cache optimization work](https://github.com/cnighswonger/claude-code-cache-fix), we discovered:

- Exceeding 100% of the 5-hour quota triggers a TTL downgrade from 1h to 5m
- Quota utilization percentages are exposed in API response headers
- Each API call produces a (token_counts, quota_delta) pair — enough for regression analysis
- Session-level OLS regression reveals billing weights per token type

One user sees one usage pattern. Many users see the full rate surface. claude-code-meter aggregates anonymized metrics to derive empirical cost models.

## Install

```bash
npm install -g claude-code-meter
```

**Required collector:** since v0.4.0, claude-meter ingests data written by the [claude-code-cache-fix](https://github.com/cnighswonger/claude-code-cache-fix) proxy (>= 3.2.0). The proxy emits `MeterRowSchema` v:1 records to `~/.claude/usage.jsonl`; claude-meter reads from that file. The legacy `NODE_OPTIONS=--import` preload no longer works on Claude Code v2.1.113+ because the Bun binary ignores `NODE_OPTIONS`.

```bash
# 1. Install the proxy (once)
npm install -g claude-code-cache-fix
cache-fix-proxy install-service

# 2. Enable the usage-log extension by editing
#    ~/.config/cache-fix-proxy/extensions.json (or your installed proxy/extensions.json)
#    and adding:
#      "usage-log": { "enabled": true, "order": 650 }

# 3. Restart the proxy and start ingesting
systemctl --user restart cache-fix-proxy
claude-meter ingest --watch
```

`claude-meter ingest` validates each row against the strict v:1 schema and **persists each valid row into `~/.claude/claude-meter.jsonl`** — the same local store that `analyze`, `share`, `status`, `history`, and `rates` already read from. No downstream command changes are needed; proxy-ingested rows are visible to all existing readers transparently. Old preload-format rows in any pre-existing source files are skipped (debug-logged when `CLAUDE_METER_DEBUG=1`). Requires Node.js 18+.

> **Deprecation**: the `src/interceptor/preload.mjs` entry point still loads under Node-binary CC ≤ v2.1.112 but emits a deprecation warning on every invocation. The npm `./preload` export was removed in v0.4.0. The entry point itself is scheduled for removal in v1.0.0.

## Usage

### Collect data

Run `claude-meter ingest` (or `--watch` for continuous tailing) to pull rows from the proxy's `~/.claude/usage.jsonl`. The ingest command persists a byte offset to `~/.claude/.claude-meter-ingest-offset` so subsequent runs only process new rows. Ingest commands:

```bash
claude-meter ingest                    # read to current EOF, exit
claude-meter ingest --watch            # tick every 1s until Ctrl-C
claude-meter ingest --source <path>    # override source file path
claude-meter ingest --reset-offset     # re-process from start (asks before deleting offset)
```

### Analyze your cost model

```bash
# Session-level OLS regression on your local data
claude-meter analyze

# Output: R-squared, coefficients per token type, Pearson correlations,
# cumulative cost exponent, peak vs off-peak splits, model splits
```

This is the core feature — it runs statistical analysis on your accumulated usage data and produces a shareable JSON summary showing how your quota drain maps to token types.

### Cost-multiplier reporting (M(t))

```bash
# Amortized M(t) — what your subscription buys vs API list price
claude-meter analyze --by-plan --plan max-5x

# Per-session "sub-days consumed" — strictly bounded per-session metric
claude-meter analyze --per-session --plan max-5x

# Filter to a single session
claude-meter analyze --session <sid> --by-plan --plan max-5x

# Span-extrapolated burn intensity (diagnostic — NOT M(t))
claude-meter analyze --burn-intensity --plan max-5x
```

**What M(t) means here.** We report

    M(t)  =  sum(api_equivalent_cost)  /  ( daily_sub_price × calendar_days )

Numerator: API-equivalent cost using Anthropic's published per-token rates, with cache reads priced at Anthropic's cache-read rate (10% of base).
Denominator: subscription daily list price × inclusive calendar-day span of the data window (`last_day − first_day + 1` in UTC). Gap days count — the sub is paying for them.
Aggregation grain: one number per host (per `~/.claude/claude-meter.jsonl`). Multi-agent setups will read higher than a single user's typical session.

Plan list prices are pinned to [claude.com/pricing](https://claude.com/pricing) (verified 2026-05-01). Override with `--list-price-override max-5x=3.50`. Mid-window plan changes: `--plan-transitions 2026-04-15=max-5x,2026-04-22=max-20x`.

**Why a separate `--burn-intensity` flag.** The old "intensity" formula divides cost by session span (with a 1h floor for short sessions). For a 5-minute burst it extrapolates burn rate as if sustained for 24 hours, which makes the number look 10–100× higher than any meaningful sustained M(t). It's useful for ranking sessions by intensity, but not as a published M(t) — hence the separate flag and the `caveat` field in its output.

### Share with the community (opt-in)

```bash
# Analyze + submit to community dataset
claude-meter analyze --share

# Shows the exact JSON before sending. You confirm before anything is transmitted.
```

Data goes to [meter.vsits.co](https://meter.vsits.co) and is visible on the community dashboard.

### View your metrics

```bash
# Current session summary
claude-meter status

# Daily/weekly history
claude-meter history
claude-meter history --days 30
```

## Privacy

### What is captured locally

| Field | Example | Purpose |
|-------|---------|---------|
| `input_tokens` | `3` | Token count |
| `cache_read_input_tokens` | `24958` | Cache hit volume |
| `ephemeral_1h_input_tokens` | `1068` | TTL tier detection |
| `q5h` | `0.88` | Quota utilization |
| `model` | `claude-opus-4-6` | Rate stratification |

### What is never captured

- Prompts, responses, or any message content
- File paths, repo names, or project structure
- Tool names or schemas
- IP addresses or hostnames

### What is shared (opt-in only)

Aggregate statistics: R-squared, OLS coefficients, Pearson correlations, cumulative exponents, model splits, peak/off-peak averages. No per-turn data. No timestamps more precise than session date range.

The share payload is validated against a strict Zod schema — unknown fields are rejected both client-side and server-side.

## How the cost model works

Each API call produces a paired observation:

```
quota_delta = w1*output + w2*cache_creation + w3*cache_read + w4*input + noise
```

Session-level OLS regression solves for the billing weights per token type. Our findings from 13,000+ calls:

- **Output tokens dominate cost** (Pearson r=0.57, coefficient +1.05e-5 Q5h/token)
- **Cache reads are nearly free** (r=0.28, coefficient ~7e-9 — effectively zero)
- **Cost accumulation is approximately linear** (exponent mean 0.82, not quadratic)
- **Peak hours cost ~12% more** than off-peak

## Architecture

```
API Response
  → response.clone() (original passes through untouched)
  → drain clone for usage object (async, fire-and-forget)
  → extract rate-limit headers (synchronous)
  → validate against Zod schema
  → append to ~/.claude/claude-meter.jsonl
```

The interceptor uses `response.clone()`, not `TransformStream`. This is critical — TransformStream wrapping breaks Claude Code's SSE streaming.

## Community server

The live server at [meter.vsits.co](https://meter.vsits.co) accepts community submissions and visualizes aggregate data.

API endpoints:
- `POST /api/v1/submit` — submit analysis summary (anonymous or API key)
- `GET /api/v1/dataset` — download public dataset (JSON or CSV)
- `GET /api/v1/stats` — aggregate statistics
- `POST /api/v1/register` — generate a write API key (higher rate limits)
- `GET /api/v1/schema` — current accepted schema

Rate limits: 10 submissions/day anonymous, 100/day with API key.

## Security

- **Interceptor never accesses request bodies** — structurally can't leak prompts
- **Strict schema validation** — `z.strictObject()` rejects unknown keys on both client and server
- **Inspect before send** — `analyze --share` shows the exact payload before transmission
- **Server hardened** — rate limiting, slowloris protection, CSV injection prevention, payload size caps, fail2ban
- **19 security regression tests** covering 8 attack vectors

## Related

- [claude-code-cache-fix](https://github.com/cnighswonger/claude-code-cache-fix) — Prompt cache fix interceptor (108+ stars)
- [claude-usage-dashboard](https://github.com/fgrosswig/claude-usage-dashboard) — Token forensics dashboard by @fgrosswig. The subscription cost-multiplier concept (`M_real` / `computeSessionMt`, April 13 2026) predates meter's `M(t)`; the two use different formulas.
- [Blog series](https://vsits.co/three-layer-gate-quota-overage/) — Technical analysis of Claude Code's cache mechanics

## Support

If this tool helped you understand your Claude Code costs, consider buying us a coffee:

<a href="https://buymeacoffee.com/vsits" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

## License

MIT
