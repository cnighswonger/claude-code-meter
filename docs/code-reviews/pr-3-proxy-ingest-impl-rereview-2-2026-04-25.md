# Re-review 2: PR #3 proxy ingest implementation

Date: 2026-04-25
Reviewed: `src/cli/ingest.mjs`, `src/ingest/jsonl-tailer.mjs`, `test/ingest-cli.test.mjs`, `test/ingest-tailer.test.mjs`
Branch: `pr-3`
Head commit reviewed: `235f38a`
Verdict: `APPROVE`

## Verification

- The tailer now separates validation from persistence. Validation failures still call `onSkip`, increment `skipped`, and advance the offset past the bad row because retrying malformed data is pointless ([src/ingest/jsonl-tailer.mjs](/home/manager/git_repos/claude-meter/src/ingest/jsonl-tailer.mjs:145)). Persistence failures from `onRow` now set `persistError`, emit a warning, and `break` before counting the failed row or any later rows in the batch, so order is preserved and rows 3+ are not advanced past when row 2 fails ([src/ingest/jsonl-tailer.mjs](/home/manager/git_repos/claude-meter/src/ingest/jsonl-tailer.mjs:164)).
- Per-row byte tracking is implemented correctly. The tailer no longer advances by `Buffer.byteLength(completeBlock)`. Instead it accumulates `Buffer.byteLength(line, "utf8") + 1` only for rows that were successfully processed or intentionally skipped, then saves `offset + bytesConsumed` ([src/ingest/jsonl-tailer.mjs](/home/manager/git_repos/claude-meter/src/ingest/jsonl-tailer.mjs:135), [src/ingest/jsonl-tailer.mjs](/home/manager/git_repos/claude-meter/src/ingest/jsonl-tailer.mjs:175)).
- `ingest.mjs` no longer swallows sink write failures. `appendFileSync()` now throws through `onRow`, which routes disk-full or permission errors into the tailer’s persistence-failure path instead of falsely counting the row as processed ([src/cli/ingest.mjs](/home/manager/git_repos/claude-meter/src/cli/ingest.mjs:58)).
- The CLI surfaces the failure path correctly. Summary formatting includes `persistError` when present, and `ingest --once` sets exit code 1 if a persistence error occurred ([src/cli/ingest.mjs](/home/manager/git_repos/claude-meter/src/cli/ingest.mjs:15), [src/cli/ingest.mjs](/home/manager/git_repos/claude-meter/src/cli/ingest.mjs:80)).
- Regression test #4 covers the lossy-path fix directly. It simulates a sink failure on row 2 of 3, asserts `processed === 1`, asserts `persistError` is populated, verifies the saved offset equals `Buffer.byteLength(JSON.stringify(row1) + "\n", "utf8")`, and confirms the retry tick processes rows 2 and 3 ([test/ingest-cli.test.mjs](/home/manager/git_repos/claude-meter/test/ingest-cli.test.mjs:93)).

## Edge checks

- Order preservation is correct: the `break` on persistence failure prevents any subsequent row in the batch from being processed or counted.
- Empty trailing lines are handled correctly: `split("\n")` does produce a final empty string for a block ending in `\n`, but `if (!line) continue;` skips it before byte accounting, and the preceding row already accounted for that newline byte.
- First-call semantics remain compatible with existing tests. Missing source still returns exactly `{ processed: 0, skipped: 0, offset: 0 }` without `persistError`, so the `deepEqual` assertions continue to pass ([src/ingest/jsonl-tailer.mjs](/home/manager/git_repos/claude-meter/src/ingest/jsonl-tailer.mjs:87), [test/ingest-tailer.test.mjs](/home/manager/git_repos/claude-meter/test/ingest-tailer.test.mjs:47), [test/ingest-cli.test.mjs](/home/manager/git_repos/claude-meter/test/ingest-cli.test.mjs:75)).
- The newline math is correct for the implementation’s current assumption set. `+ 1` for `\n` is accurate on POSIX UTF-8 input, and I did not find any ingest-path tests or code handling `\r\n`; if Windows-style line endings are ever expected for this source, that would need separate coverage.

## Tests

- `node --test test/ingest-tailer.test.mjs test/ingest-cli.test.mjs`
- Result: 14 passed, 0 failed

Codex Review Agent
