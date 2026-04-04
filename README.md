# claude-meter

Community usage metrics collector for Claude Code. Captures anonymized billing data from API responses to reverse-engineer Anthropic's pricing model through statistical analysis.

## What it does

claude-meter intercepts Claude Code API responses (read-only) and logs:
- Token counts by type (input, output, cache read, cache write)
- Cache TTL tier (1-hour vs 5-minute ephemeral)
- Quota utilization (5-hour and 7-day windows)
- Overage status transitions

It **never** accesses prompts, code, file contents, or any request data. Only numeric usage metrics and rate-limit headers from API responses are captured.

## Why

Anthropic doesn't publish how Claude Code subscription billing maps to token usage. Through our [cache optimization work](https://github.com/anthropics/claude-code/issues/42052), we discovered:

- Exceeding 100% of the 5-hour quota triggers a TTL downgrade from 1h to 5m, creating a runaway cost feedback loop
- Quota utilization percentages are exposed in API response headers
- The `cache_creation` sub-object reveals which TTL tier your account is on
- Each API call produces a (token_counts, quota_delta) pair — enough for regression analysis

One user sees one usage pattern. Many users see the full rate surface. claude-meter aggregates anonymized metrics to derive billing weights per token type.

## Install

```bash
npm install -g @claude-meter/collector
claude-meter setup
```

Or manually: clone this repo and add the interceptor to your Claude Code wrapper:

```bash
# In your ~/bin/claude wrapper, add to NODE_OPTIONS:
NODE_OPTIONS="--import /path/to/claude-meter/src/interceptor/preload.mjs"
```

Requires Node.js 18+ and the Claude Code npm package (not the standalone binary).

## Usage

### Collect data

Once installed, the interceptor runs automatically on every Claude Code session. Data is written to `~/.claude/claude-meter.jsonl`.

### View your metrics

```bash
# Current session summary
claude-meter status

# Output:
# Session: 0fdee93d | 47 turns | 2h 14m
# Tokens:  1.2M input | 89k output | 4.1M cache read | 312k cache write
# Cache:   78% hit rate (avg)
# Quota:   5h: 28% | 7d: 20%
# TTL:     1h tier

# Daily/weekly history
claude-meter history
claude-meter history --days 30

# Estimate billing rates (needs 10+ data points with quota movement)
claude-meter rates
```

### Share with the community (opt-in)

```bash
# Register with community endpoint
claude-meter setup --endpoint https://your-endpoint.example.com

# Review and submit anonymized session summary
claude-meter share --plan max_20
```

The `share` command displays the exact JSON payload before sending. You confirm before anything is transmitted.

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
- Session IDs, account IDs, or org IDs
- IP addresses or hostnames

### What is shared (opt-in only)

Session-level aggregates: total tokens by type, quota start/end percentages, turn count, model, plan tier. No per-turn data. Date granularity is day only.

The share payload is validated against a strict Zod schema (`z.strictObject`) — unknown fields are rejected both client-side and server-side. There are no freeform string fields.

## How rate estimation works

Each API call produces a paired observation:

```
quota_delta = w1*input + w2*output + w3*cache_read + w4*cache_write + noise
```

With enough observations, ordinary least squares (OLS) regression solves for the billing weights per token type. The `rates` command runs this locally on your data, or with `--community` on the aggregated public dataset.

Results are compared against known API pricing tiers from Claude Code's source for validation.

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

## Self-hosted server

The `server/` directory contains a standalone API endpoint for receiving community submissions:

```bash
cd server
npm install
PORT=3847 DATA_DIR=./data node index.mjs
```

Routes:
- `POST /api/v1/submit` — submit a share payload (requires API key)
- `GET /api/v1/dataset` — download public dataset (JSON or CSV)
- `GET /api/v1/stats` — aggregate statistics
- `POST /api/v1/register` — generate a write API key

## Security

- **Interceptor never accesses request bodies** — structurally can't leak prompts
- **Strict schema validation** — `z.strictObject()` rejects unknown keys on both client and server
- **Inspect before send** — `share` command shows the exact payload before transmission
- **Self-integrity check** — interceptor hashes its own source on load, warns if modified
- **npm provenance** — published with Sigstore attestation linking package to source commit

## License

MIT
