// `claude-meter ingest` — read MeterRowSchema v:1 records emitted by the
// cache-fix proxy's usage-log extension. See docs/directives/proxy-ingest.md.

import { existsSync } from "node:fs";
import { createInterface } from "node:readline";

import { JsonlTailer } from "../ingest/jsonl-tailer.mjs";
import { PROXY_LOG_FILE, INGEST_OFFSET_FILE } from "../constants.mjs";

function fmtSummary({ processed, skipped, offset }) {
  return `processed=${processed} skipped=${skipped} offset=${offset}`;
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

export async function ingestCommand(args = {}) {
  const source = args.source || PROXY_LOG_FILE;
  const offsetFile = args.offsetFile || INGEST_OFFSET_FILE;
  const watch = !!args.watch;
  const resetOffset = !!args.resetOffset;
  const yes = !!args.yes;
  const intervalMs = Number.isFinite(args.intervalMs) ? args.intervalMs : 1000;

  if (!existsSync(source)) {
    console.warn(`source not found: ${source}`);
    console.warn("Hint: install claude-code-cache-fix >= 3.2.0 and enable the");
    console.warn("usage-log extension in proxy/extensions.json:");
    console.warn('  "usage-log": { "enabled": true, "order": 650 }');
    process.exitCode = 0;
    return { processed: 0, skipped: 0, offset: 0 };
  }

  const tailer = new JsonlTailer({
    source,
    offsetFile,
    onRow: () => {},        // for now, validation count is enough; downstream consumers can override
    onSkip: () => {},
  });

  if (resetOffset) {
    if (!yes) {
      const ok = await confirm(`Reset ingestion offset (will re-process all rows in ${source})?`);
      if (!ok) {
        console.log("Cancelled.");
        return { processed: 0, skipped: 0, offset: 0 };
      }
    }
    await tailer.resetOffset();
    console.log(`Offset reset: ${offsetFile}`);
  }

  if (!watch) {
    const result = await tailer.tickOnce();
    console.log(`ingest --once: ${fmtSummary(result)}`);
    return result;
  }

  console.log(`ingest --watch (interval=${intervalMs}ms, source=${source})`);
  console.log("Press Ctrl-C to stop.");
  let totalProcessed = 0;
  let totalSkipped = 0;
  const onTick = ({ processed, skipped, offset }) => {
    if (processed || skipped) {
      totalProcessed += processed;
      totalSkipped += skipped;
      console.log(`tick ${new Date().toISOString()}: ${fmtSummary({ processed, skipped, offset })}`);
    }
  };
  const stop = tailer.startWatch(intervalMs, onTick);

  return new Promise((resolve) => {
    const cleanup = () => {
      stop();
      console.log(`final: processed=${totalProcessed} skipped=${totalSkipped}`);
      resolve({ processed: totalProcessed, skipped: totalSkipped });
    };
    process.once("SIGINT", () => { cleanup(); process.exit(0); });
    process.once("SIGTERM", () => { cleanup(); process.exit(0); });
  });
}
