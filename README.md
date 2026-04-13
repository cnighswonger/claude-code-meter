# claude-code-meter

Community usage metrics collector for Claude Code. Captures anonymized billing data from API responses and provides session-level cost modeling through statistical analysis.

**Live dashboard:** [meter.veritassuperaitsolutions.com](https://meter.veritassuperaitsolutions.com)

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

Add the interceptor to your Claude Code wrapper:

```bash
# In your ~/bin/claude or wrapper script, add to NODE_OPTIONS:
NODE_OPTIONS="--import $(npm root -g)/claude-code-meter/src/interceptor/preload.mjs"
```

If you're already using [claude-code-cache-fix](https://github.com/cnighswonger/claude-code-cache-fix), add the meter as a second `--import` — cache-fix first (modifies requests), meter second (reads responses).

Requires Node.js 18+ and the Claude Code npm package (not the standalone binary).

## Usage

### Collect data

Once installed, the interceptor runs automatically on every Claude Code session. Data is written to `~/.claude/claude-meter.jsonl`.

### Analyze your cost model

```bash
# Session-level OLS regression on your local data
claude-meter analyze

# Output: R-squared, coefficients per token type, Pearson correlations,
# cumulative cost exponent, peak vs off-peak splits, model splits
```

This is the core feature — it runs statistical analysis on your accumulated usage data and produces a shareable JSON summary showing how your quota drain maps to token types.

### Share with the community (opt-in)

```bash
# Analyze + submit to community dataset
claude-meter analyze --share

# Shows the exact JSON before sending. You confirm before anything is transmitted.
```

Data goes to [meter.veritassuperaitsolutions.com](https://meter.veritassuperaitsolutions.com) and is visible on the community dashboard.

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

The live server at [meter.veritassuperaitsolutions.com](https://meter.veritassuperaitsolutions.com) accepts community submissions and visualizes aggregate data.

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
- [claude-usage-dashboard](https://github.com/fgrosswig/claude-usage-dashboard) — Token forensics dashboard by @fgrosswig
- [Blog series](https://veritassuperaitsolutions.com/three-layer-gate-quota-overage/) — Technical analysis of Claude Code's cache mechanics

## Support

If this tool helped you understand your Claude Code costs, consider buying us a coffee:

<a href="https://buymeacoffee.com/vsits" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

## License

MIT
