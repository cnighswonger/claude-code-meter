import { readFileSync, existsSync } from "node:fs";
import { LOG_FILE } from "../constants.mjs";

/**
 * Read and parse all rows from the JSONL log.
 * Returns an array of parsed objects. Skips malformed lines.
 */
export function readAllRows(logFile = LOG_FILE) {
  if (!existsSync(logFile)) return [];

  const lines = readFileSync(logFile, "utf-8").split("\n");
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // Skip malformed lines
    }
  }
  return rows;
}

/**
 * Filter rows to a specific session.
 */
export function filterBySession(rows, sid) {
  return rows.filter((r) => r.sid === sid);
}

/**
 * Filter rows to a specific date range.
 */
export function filterByDateRange(rows, startDate, endDate) {
  return rows.filter((r) => {
    const d = r.ts.slice(0, 10);
    return d >= startDate && d <= endDate;
  });
}

/**
 * Filter rows to a stable 5h quota window (same reset timestamp).
 * This is critical for regression — quota deltas across reset boundaries are meaningless.
 */
export function filterByQuotaWindow(rows) {
  if (rows.length === 0) return [];
  // Group by q5h_reset
  const windows = new Map();
  for (const r of rows) {
    const key = r.q5h_reset;
    if (!windows.has(key)) windows.set(key, []);
    windows.get(key).push(r);
  }
  // Return the largest window
  let largest = [];
  for (const group of windows.values()) {
    if (group.length > largest.length) largest = group;
  }
  return largest;
}

/**
 * Group rows into all Q5h windows by `q5h_reset`. Returns a Map keyed by
 * q5h_reset, with each entry carrying the rows and the max observed q5h in
 * the window (the cumulative quota fraction consumed in that window).
 *
 * Distinct from `filterByQuotaWindow` which returns only the largest single
 * window. The per-window aggregator at the regression layer needs ALL
 * windows to apply filters, hold-out, and per-(model|speed) grouping.
 */
export function groupByQuotaWindow(rows) {
  const windows = new Map();
  for (const r of rows) {
    if (r.q5h_reset === undefined || r.q5h_reset === null) continue;
    if (!windows.has(r.q5h_reset)) {
      windows.set(r.q5h_reset, { q5h_reset: r.q5h_reset, rows: [], q5h_max: 0 });
    }
    const w = windows.get(r.q5h_reset);
    w.rows.push(r);
    if (typeof r.q5h === "number" && r.q5h > w.q5h_max) w.q5h_max = r.q5h;
  }
  return windows;
}

/**
 * Group rows by date (YYYY-MM-DD).
 */
export function groupByDate(rows) {
  const groups = new Map();
  for (const r of rows) {
    const date = r.ts.slice(0, 10);
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(r);
  }
  return groups;
}

/**
 * Group rows by session ID.
 */
export function groupBySession(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.sid)) groups.set(r.sid, []);
    groups.get(r.sid).push(r);
  }
  return groups;
}
