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
