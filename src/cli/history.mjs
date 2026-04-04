import { readAllRows, groupByDate } from "../log/reader.mjs";

/**
 * Display daily/weekly usage aggregates.
 */
export function historyCommand(args) {
  const rows = readAllRows();
  if (rows.length === 0) {
    console.log("No usage data found.");
    return;
  }

  const days = args.days || 7;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const filtered = rows.filter((r) => r.ts.slice(0, 10) >= cutoffStr);
  if (filtered.length === 0) {
    console.log(`No data in the last ${days} days.`);
    return;
  }

  const dateGroups = groupByDate(filtered);
  const dates = [...dateGroups.keys()].sort();

  console.log(`Usage history (last ${days} days):\n`);
  console.log(
    padR("Date", 12) +
    padR("Turns", 7) +
    padR("Input", 10) +
    padR("Output", 10) +
    padR("CacheRd", 10) +
    padR("CacheWr", 10) +
    padR("Hit%", 7) +
    padR("Q5h", 6) +
    padR("Q7d", 6),
  );
  console.log("-".repeat(86));

  for (const date of dates) {
    const dayRows = dateGroups.get(date);
    let inp = 0, out = 0, cr = 0, cw = 0;
    for (const r of dayRows) {
      inp += r.input_tokens;
      out += r.output_tokens;
      cr += r.cache_read_input_tokens;
      cw += r.cache_creation_input_tokens;
    }
    const totalIn = inp + cr + cw;
    const hitPct = totalIn > 0 ? ((cr / totalIn) * 100).toFixed(0) : "0";
    const last = dayRows[dayRows.length - 1];

    console.log(
      padR(date, 12) +
      padR(String(dayRows.length), 7) +
      padR(fmtK(inp), 10) +
      padR(fmtK(out), 10) +
      padR(fmtK(cr), 10) +
      padR(fmtK(cw), 10) +
      padR(hitPct + "%", 7) +
      padR(Math.round(last.q5h * 100) + "%", 6) +
      padR(Math.round(last.q7d * 100) + "%", 6),
    );
  }

  // Totals
  let tInp = 0, tOut = 0, tCr = 0, tCw = 0;
  for (const r of filtered) {
    tInp += r.input_tokens;
    tOut += r.output_tokens;
    tCr += r.cache_read_input_tokens;
    tCw += r.cache_creation_input_tokens;
  }
  const tTotal = tInp + tCr + tCw;
  const tHit = tTotal > 0 ? ((tCr / tTotal) * 100).toFixed(0) : "0";

  console.log("-".repeat(86));
  console.log(
    padR("TOTAL", 12) +
    padR(String(filtered.length), 7) +
    padR(fmtK(tInp), 10) +
    padR(fmtK(tOut), 10) +
    padR(fmtK(tCr), 10) +
    padR(fmtK(tCw), 10) +
    padR(tHit + "%", 7),
  );
}

function padR(s, len) {
  return s.padEnd(len);
}

function fmtK(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}
