# Directive: accept `ttl_tier` and `duration_ms` on meter rows

Status: **proposed**. Prerequisite for `cnighswonger/claude-code-cache-fix#297`.

## Goal

`MeterRowSchema` is a `z.strictObject`. It rejects rows carrying keys it does
not declare. cache-fix #297 wants to emit two new fields into `usage.jsonl`;
until this schema accepts them, **every gated row would be silently dropped**
rather than rejected loudly.

That failure is silent by construction and worth stating precisely, because it
is the whole reason this directive blocks rather than parallels:

- `src/log/writer.mjs:68-70` — `safeParse` fails → returns `null`, no throw.
- `src/ingest/jsonl-tailer.mjs:143-153` — `parse` throws → counted as skipped,
  offset advances past the row, `debug()` only.

An operator who enabled the cache-fix gate before upgrading the meter would see
rows vanish with no error on either side.

## Scope

Two optional fields. Both are additive; a row without them stays valid, so old
producers keep working against a new meter.

| field | type | source (cache-fix side) |
| --- | --- | --- |
| `ttl_tier` | `z.enum(["5m", "1h"]).optional()` | `ctx.meta._ttlTier`, set by `ttl-tier-detect.mjs:31` (order 75) |
| `duration_ms` | `z.number().int().min(0).optional()` | time-to-response-start; needs its own timing stash on the cache-fix side |

**`upstream_status` is deliberately absent.** #297 originally carried it; Codex
established it is unreachable from usage-log's hook — usage-log emits from
`onStreamEvent`, and `stream.mjs:63` builds stream-event contexts without a
`status` field — and would be a constant `200` even if reachable, since only
`text/event-stream` responses reach that path at all. It is dropped upstream and
must not be reintroduced here.

### `ttl_tier` as an enum, not a string

The two values are the two Anthropic cache TTL tiers. An enum makes an unknown
third value a loud validation failure rather than a silently-stored string —
which is the correct behaviour if Anthropic ever ships a third tier, because a
new tier changes cost arithmetic and should not pass unnoticed.

The cost of that choice is stated rather than hidden: **a new tier from
Anthropic breaks ingestion until the meter is upgraded**, exactly like the
existing enum fields. That is the trade the schema already makes elsewhere and
this follows it rather than inventing a second convention.

### `duration_ms` semantics

Time to **response start**, not to completion — the value cache-fix can produce
without buffering. Defined explicitly here because "duration" invites the other
reading, and a consumer computing throughput from it would be wrong.

## Non-Functional Requirements

- **Size/complexity budget** — two schema lines plus comments; no new module,
  no new validation path. If an implementation lands materially larger, the
  strict-object boundary has probably been widened somewhere it should not be.
- **Threat model** — both values are cache-fix-derived telemetry, not user
  content and not credential-adjacent. `ttl_tier` is enum-constrained;
  `duration_ms` is a bounded integer. Neither is interpolated anywhere.
- **Maintainability constraints** — additive only. No changes to
  `.superRefine()`, no new cross-field invariant. Note the existing schema
  comment: `MeterRowSchema` is a `ZodEffects` wrapper, so `.shape` /
  `.extend()` / `.pick()` do not traverse it — extend the inner
  `z.strictObject`.
- **Performance/reliability** — n/a. Two optional keys on an existing parse.
- **Load-bearing?** — **yes.** It is a wire/schema contract between two
  repositories, and getting it wrong drops rows silently on both chokepoints.

## The partial-upgrade footgun

A mid-session env flip or a partially-upgraded fleet produces a **mixed file**:
ungated rows valid for old consumers, gated rows silently dropped by them.

Acceptable if documented, a footgun if not. Both sides should carry the note —
the cache-fix schema header comment, and this schema's comment block. The
sequencing rule that follows: **meter first, cache-fix gate second.** Never the
reverse.

## Out of scope, but the reason this file exists as a pattern

`cache_miss_reason` — see `cnighswonger/claude-code-cache-fix` discussion #285.
Claude Code writes `message.diagnostics.cache_miss_reason` into its own
transcript, with `cache_missed_input_tokens` attached on most variants.
Measured across two independent corpora (@Gunther-Schulz: 1,137 events;
maintainer: 2,869 events over 282 transcripts, ~694M re-billed tokens
attributed by cause). Nothing in either repo reads it today.

It belongs in this pipeline eventually and is **explicitly not in this
directive**, for one structural reason: `ttl_tier` and `duration_ms` are values
the proxy already computes in-band, while `cache_miss_reason` lives in the
transcript and needs a reader joining on `request_id`.

That join already exists in this schema. From the `request_id` comment at
`src/log/schema.mjs`:

> the post-hoc join key against CC's per-session JSONL transcripts at
> `~/.claude/projects/<project>/<session-uuid>.jsonl` (which carry the same
> value as `requestId`)

So the mechanism is shipped; only the reader is missing. When that lands it
should reuse this gate and this pattern rather than opening a third one — and
its `type` field must treat an **unknown value as loud**, since two corpora six
days apart already yielded different type sets (`model_changed` appeared in one
and not the other).

## Open question for the implementer

One env var on the cache-fix side or one per field. AITL's lean, recorded on
#297, is one — `CACHE_FIX_USAGE_LOG_EXTENDED=on` — since the fields ship
together and share this single meter-release dependency, and three flags is
three things an operator can get half-right. That decision is cache-fix-side;
this schema is indifferent to it.

Refs: `cnighswonger/claude-code-cache-fix#297`, discussion #285.
