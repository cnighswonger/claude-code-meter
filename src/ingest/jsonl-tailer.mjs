// JsonlTailer — read forward from a saved offset, validate each row through
// MeterRowSchema, persist offset across runs.
//
// Wire contract: cache-fix proxy v3.2.0+ writes MeterRowSchema v:1 records to
// the source file. Older 9-field rows fail strict validation and are skipped
// with a debug log.
//
// File rotation/truncation: if the source file's current size is LESS than
// the saved offset, we reset offset to 0 and re-process from the start. A
// warning is emitted on stderr.
//
// Trailing partial line: read forward but only advance offset past the last
// complete `\n`. The unfinished trailing fragment is reprocessed on the next
// tick.

import {
  readFile,
  writeFile,
  stat,
  open,
  unlink,
  mkdir,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

import { MeterRowSchema } from "../log/schema.mjs";

const DEBUG = process.env.CLAUDE_METER_DEBUG === "1";

function debug(msg) {
  if (DEBUG) process.stderr.write(`[claude-meter ingest] DEBUG: ${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`[claude-meter ingest] WARN: ${msg}\n`);
}

export class JsonlTailer {
  /**
   * @param {object} opts
   * @param {string} opts.source        Path to the JSONL source file.
   * @param {string} opts.offsetFile    Path to the offset persistence file.
   * @param {(row: object) => void | Promise<void>} [opts.onRow]   Per-valid-row callback.
   * @param {(skip: { line: string, error: Error }) => void | Promise<void>} [opts.onSkip] Per-invalid-row callback.
   */
  constructor({ source, offsetFile, onRow, onSkip } = {}) {
    if (!source) throw new Error("JsonlTailer: `source` is required");
    if (!offsetFile) throw new Error("JsonlTailer: `offsetFile` is required");
    this.source = source;
    this.offsetFile = offsetFile;
    this.onRow = onRow || (() => {});
    this.onSkip = onSkip || (() => {});
    this._watching = false;
    this._watchTimer = null;
  }

  async loadOffset() {
    if (!existsSync(this.offsetFile)) return 0;
    try {
      const raw = await readFile(this.offsetFile, "utf8");
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null && parsed.source === this.source && typeof parsed.offset === "number" && parsed.offset >= 0) {
        return parsed.offset;
      }
      return 0;
    } catch (err) {
      debug(`offset file unreadable, starting from 0: ${err?.message ?? err}`);
      return 0;
    }
  }

  async saveOffset(offset) {
    await mkdir(dirname(this.offsetFile), { recursive: true });
    await writeFile(
      this.offsetFile,
      JSON.stringify({ source: this.source, offset, updated_at: new Date().toISOString() }),
    );
  }

  async resetOffset() {
    if (existsSync(this.offsetFile)) {
      try { await unlink(this.offsetFile); } catch (err) {
        debug(`failed to unlink offset file: ${err?.message ?? err}`);
      }
    }
  }

  /**
   * Read forward from the saved offset to current EOF. Process complete lines.
   * Returns { processed, skipped, offset }.
   */
  async tickOnce() {
    if (!existsSync(this.source)) {
      return { processed: 0, skipped: 0, offset: 0 };
    }

    const stats = await stat(this.source);
    let offset = await this.loadOffset();

    if (offset > stats.size) {
      warn(`source file shrunk (offset=${offset} > size=${stats.size}); resetting offset to 0`);
      offset = 0;
    }

    if (offset === stats.size) {
      return { processed: 0, skipped: 0, offset };
    }

    // Read the segment from offset to EOF.
    const fh = await open(this.source, "r");
    let buffer;
    try {
      const len = stats.size - offset;
      const arr = new Uint8Array(len);
      await fh.read(arr, 0, len, offset);
      buffer = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString("utf8");
    } finally {
      await fh.close();
    }

    // Split on \n. Anything after the last \n is incomplete and stays for next tick.
    const lastNewline = buffer.lastIndexOf("\n");
    if (lastNewline < 0) {
      // No complete line in this segment — wait for more.
      return { processed: 0, skipped: 0, offset };
    }
    const completeBlock = buffer.slice(0, lastNewline + 1);

    let processed = 0;
    let skipped = 0;
    let persistError = null;
    let bytesConsumed = 0;
    // split("\n") on text ending in "\n" yields a trailing empty string. We
    // skip empties without advancing (they represent zero source bytes; the
    // preceding "\n" is already counted in the previous line's lineBytes).
    const lines = completeBlock.split("\n");
    for (const line of lines) {
      if (!line) continue;
      // Each non-empty line consumes its bytes plus the "\n" that split removed.
      const lineBytes = Buffer.byteLength(line, "utf8") + 1;

      // First: validate the row. Validation failures advance past the row
      // (the line is bad data; retrying won't help).
      let validated;
      try {
        const parsed = JSON.parse(line);
        validated = MeterRowSchema.parse(parsed);
      } catch (err) {
        debug(`skip invalid row: ${err?.message ?? err}`);
        try { await this.onSkip({ line, error: err }); } catch {}
        skipped++;
        bytesConsumed += lineBytes;
        continue;
      }

      // Then: persist via onRow. Persistence failures DO NOT advance offset.
      // The next tick re-reads the same row, giving the operator a chance to
      // fix the underlying cause (disk full, permission denied, etc.) without
      // permanently dropping data. The error is surfaced loudly via stderr
      // and returned in `persistError` so callers can react.
      try {
        await this.onRow(validated);
      } catch (err) {
        persistError = err;
        warn(
          `persistence failed; offset NOT advanced (will retry on next tick): ${err?.message ?? err}`,
        );
        break;
      }

      processed++;
      bytesConsumed += lineBytes;
    }

    const newOffset = offset + bytesConsumed;
    await this.saveOffset(newOffset);

    return { processed, skipped, offset: newOffset, persistError };
  }

  /**
   * Periodic ticks at `intervalMs` until `stopWatch()` is called. Returns a
   * cancel function. Per-tick errors are logged but do not stop the watch.
   */
  startWatch(intervalMs = 1000, onTick) {
    if (this._watching) throw new Error("already watching");
    this._watching = true;
    const tick = async () => {
      if (!this._watching) return;
      try {
        const result = await this.tickOnce();
        if (onTick) {
          try { onTick(result); } catch {}
        }
      } catch (err) {
        warn(`tick failed: ${err?.message ?? err}`);
      } finally {
        if (this._watching) {
          this._watchTimer = setTimeout(tick, intervalMs);
        }
      }
    };
    tick();
    return () => this.stopWatch();
  }

  stopWatch() {
    this._watching = false;
    if (this._watchTimer) {
      clearTimeout(this._watchTimer);
      this._watchTimer = null;
    }
  }
}
