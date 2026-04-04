import { readAllRows, filterBySession, groupBySession } from "../log/reader.mjs";

/**
 * Display current/latest session summary.
 */
export function statusCommand(args) {
  const rows = readAllRows();
  if (rows.length === 0) {
    console.log("No usage data found. Run Claude Code with claude-meter interceptor to start collecting.");
    return;
  }

  // Find the most recent session, or filter to specified sid
  const sessions = groupBySession(rows);
  let sid = args.session;
  if (!sid) {
    // Get most recent session by last timestamp
    let latestTs = "";
    for (const [s, sRows] of sessions) {
      const last = sRows[sRows.length - 1].ts;
      if (last > latestTs) {
        latestTs = last;
        sid = s;
      }
    }
  }

  const sessionRows = sessions.get(sid);
  if (!sessionRows || sessionRows.length === 0) {
    console.log(`No data for session ${sid}`);
    return;
  }

  const first = sessionRows[0];
  const last = sessionRows[sessionRows.length - 1];
  const durationMs = new Date(last.ts) - new Date(first.ts);
  const durationMin = Math.round(durationMs / 60000);
  const hours = Math.floor(durationMin / 60);
  const mins = durationMin % 60;
  const durationStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  // Aggregate tokens
  let totalInput = 0, totalOutput = 0, totalCacheCreate = 0, totalCacheRead = 0;
  let totalWebSearch = 0;
  for (const r of sessionRows) {
    totalInput += r.input_tokens;
    totalOutput += r.output_tokens;
    totalCacheCreate += r.cache_creation_input_tokens;
    totalCacheRead += r.cache_read_input_tokens;
    totalWebSearch += r.web_search_requests;
  }

  const totalIn = totalInput + totalCacheCreate + totalCacheRead;
  const avgCacheHit = totalIn > 0 ? totalCacheRead / totalIn : 0;

  console.log(`Session: ${sid} | ${sessionRows.length} turns | ${durationStr}`);
  console.log(`Tokens:  ${fmtK(totalInput)} input | ${fmtK(totalOutput)} output | ${fmtK(totalCacheRead)} cache read | ${fmtK(totalCacheCreate)} cache write`);
  if (totalWebSearch > 0) console.log(`Search:  ${totalWebSearch} web search requests`);
  console.log(`Cache:   ${(avgCacheHit * 100).toFixed(1)}% hit rate (avg)`);
  console.log(`Quota:   5h: ${Math.round(last.q5h * 100)}% | 7d: ${Math.round(last.q7d * 100)}%`);
  if (last.qoverage && last.qoverage !== "allowed") {
    console.log(`Overage: ${last.qoverage}`);
  }

  // TTL tier detection from last few rows
  const recent = sessionRows.slice(-5);
  const has1h = recent.some((r) => r.ephemeral_1h_input_tokens > 0);
  const has5m = recent.some((r) => r.ephemeral_5m_input_tokens > 0);
  if (has1h && !has5m) console.log(`TTL:     1h tier`);
  else if (has5m && !has1h) console.log(`TTL:     5m tier`);
  else if (has1h && has5m) console.log(`TTL:     Mixed (1h/5m transition detected)`);
}

function fmtK(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}
