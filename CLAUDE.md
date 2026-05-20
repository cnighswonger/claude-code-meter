# Project: claude-meter

## Session State

**On resume, compaction, or context loss:** Read `SESSION_STATE.md` in this directory immediately. It contains the current working state — infrastructure, pending tasks, recent fixes, and architectural constraints. Update it when significant state changes occur.

**Never post publicly without Chris's approval.** Draft and wait for go-ahead.

## Overview

Community usage metrics collector for Claude Code. Captures anonymized billing data from API responses to enable statistical analysis of Anthropic's pricing model through community data aggregation.

## Git Workflow

- **Do not push directly to `main` unless the user explicitly instructs you to do so in the current turn.** Otherwise use feature branches and PRs, even for small fixes.
- If writing directly to `main` is explicitly authorized, pull/rebase from `origin/main` before any other write action so you start from the current remote tip.
- Branch naming: `feature/<name>` for features, `fix/<name>` for bugfixes.
- Commit messages: lead with what changed and why, not how.

## Repository Structure

- `bin/claude-meter.mjs` — CLI entry point (status, history, rates, share, setup)
- `src/`
  - `constants.mjs` — paths, known API rates, rate-limit header names
  - `interceptor/` — Node.js fetch interceptor (loaded via `NODE_OPTIONS=--import`)
    - `preload.mjs` — entry point for `--import`
    - `fetch-patch.mjs` — `response.clone()` based fetch wrapper
    - `usage-extractor.mjs` — drains cloned SSE stream for usage object
    - `integrity.mjs` — self-hash tamper detection on load
  - `log/` — local JSONL data layer
    - `schema.mjs` — Zod schemas (per-turn row + community share payload)
    - `writer.mjs` — build and append validated JSONL rows
    - `reader.mjs` — parse, filter, group JSONL for CLI
  - `cli/` — CLI command implementations
    - `status.mjs` — current session summary
    - `history.mjs` — daily/weekly usage aggregates
    - `rates.mjs` — OLS regression for billing weight estimation
    - `share.mjs` — interactive payload review + community submission
    - `setup.mjs` — wrapper detection and interceptor integration
  - `share/` — community data pipeline
    - `payload-builder.mjs` — aggregates per-turn JSONL into per-session share payload
    - `client.mjs` — HTTP client for community API endpoint
- `server/index.mjs` — community API server (deployed separately)

## Key Patterns

- **Interceptor uses `response.clone()`** — NOT TransformStream. The budmon-interceptor proved that TransformStream wrapping breaks Claude Code's SSE streaming (compaction failures, resume failures). `response.clone()` lets the original response pass untouched while draining the clone asynchronously. Do not switch to TransformStream.
- **The interceptor never accesses `request.body`.** This is the core privacy guarantee. The usage extraction function receives only the response object. Prompts, code, and file contents are structurally inaccessible.
- **Strict Zod schemas with `z.strictObject()`** — rejects unknown keys. No freeform text fields in either the local JSONL or the share payload. Model ID and status fields use regex/enum constraints.
- **Quota delta is the key regression signal.** Each API call pairs (token_counts, q5h_delta). OLS regression across many observations derives billing weights per token type. Filter to stable 5h windows (same `q5h_reset` timestamp) — deltas across reset boundaries are meaningless.
- **The share payload aggregates to session level.** Per-turn granularity never leaves the user's machine. Date granularity is day only (YYYY-MM-DD). This makes it structurally impossible to reconstruct conversation patterns.

## Security Principles

These are non-negotiable design constraints, not suggestions:

1. **No content access.** The interceptor must never read, log, or transmit request bodies or response content. Only `response.headers` and `response.usage` (from the SSE stream) are in scope.
2. **Schema enforcement.** Both client-side (JSONL writer) and server-side (API endpoint) validate against strict Zod schemas. New fields require schema version bumps.
3. **Inspect before send.** The `share` command always displays the exact JSON payload and requires explicit confirmation before transmission.
4. **Integrity verification.** The interceptor hashes its own source on load and warns if modified since install. The `__INTEGRITY_HASH__` placeholder is replaced at npm publish time.
5. **npm provenance.** Publish with `--provenance` for Sigstore attestation linking the package to its source commit.
6. **No origin-server secrets in tracked files.** See "Public-Repo Information Hygiene" below.

## Public-Repo Information Hygiene

This repository is public. Anything committed becomes part of public git history immediately and cannot be retracted by editing or deleting the file later. Before any commit, scan for origin-server-identifying information and replace it with placeholders + a pointer to internal deployment notes.

**Never put in tracked files:**

- **Origin IPs** — literal IPv4/IPv6 addresses pointing at production hosts (droplets, load balancers, VPS, etc.)
- **SSH targets** — `ssh root@<ip>` lines, hostname-port pairs that reach origin
- **Internal service ports** that aren't surfaced through the public reverse-proxy / CDN
- **Stack fingerprinting** — server hostnames combined with "what's running" details (e.g. `vsits-meter-01, Node 20 + Caddy + systemd, port 3847`). Fingerprinting narrows the attack surface even after an IP rotation.

**Why this is non-negotiable:** Cloudflare's WAF / DDoS protection only protects traffic that actually flows through Cloudflare. If the origin IP is in a public repo, an attacker can bypass Cloudflare entirely and hit the origin directly. The remediation path for an IP that has already been leaked to git history is rotating the IP itself (snapshot + recreate, or floating-IP reassignment) — there is no in-place "scrub" because git history is immutable.

**Acceptable patterns in public docs and runbooks:**

- `<droplet>` or `<DROPLET_IP>` placeholder in place of literal IPs
- `ssh root@<droplet>` rather than `ssh root@143.198.x.x`
- One-line pointer: "(host details in internal deployment notes — see `SESSION_STATE.md` on the operator's local checkout)" or similar. Keeps the runbook useful for someone with proper access without leaking the value.
- Generic deployment shape descriptions are fine: "single DigitalOcean droplet behind Cloudflare-proxied DNS" gives readers the shape without enabling bypass.

**Scope:** This applies to ALL tracked files: source code, comments, `README.md`, `CHANGELOG.md`, `SESSION_STATE.md`, handoff docs under `docs/`, commit messages, PR descriptions, issue comments. Scan for literal IPs (v4/v6), SSH lines, and hostname-port-stack tuples before any `git commit`, `git push`, or `gh` write operation.

## Architecture Decisions

- **ESM throughout.** All files use ES module syntax (`import`/`export`). The package uses `"type": "module"`.
- **Zero runtime dependencies beyond Zod.** The interceptor and CLI use only Node.js builtins + Zod for schema validation. No HTTP framework for the server (uses `node:http`).
- **Coexistence with cache-fix-preload.mjs.** The interceptor chains via `NODE_OPTIONS`. Load order: cache-fix first (modifies requests), claude-meter second (reads responses). The meter's `_origFetch` captures the cache-fix-patched version, which is correct.
- **OLS regression is pure JavaScript.** No numpy or external math libraries. The 4x4 normal equations are solved via Gauss-Jordan elimination. This keeps the dependency count at exactly one (Zod).

## Code Quality

- **Forced verification.** Do not report a task as complete until you have:
  - Run `node --check` on all changed `.mjs` files
  - Run `node --test test/` if tests exist for the changed code
  - Fixed ALL resulting errors
  - If verification is not possible, state that explicitly instead of claiming success.
- **Read code before modifying.** Do not assume API structures, schema fields, or function signatures.
- **Flag architectural issues, don't silently refactor.** If the privacy boundary needs adjustment or the schema needs new fields, discuss first. Unilateral changes to the interceptor or share payload schema could break the security guarantees.

## Token Economy

- Avoid redundant file reads — don't re-read files already in context unless they've changed.
- Use targeted reads with offset/limit for large JSONL logs.
- Keep tool output small — use `wc -l`, `tail`, or targeted scripts rather than dumping full file contents.

## Context Management

- After 10+ messages or any auto-compaction, re-read files before editing. Editing against stale context causes silent failures.
- For multi-file changes, complete a logical unit, verify, then proceed to the next.
