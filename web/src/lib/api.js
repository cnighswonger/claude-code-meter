// web/src/lib/api.js
//
// Fetches /api/v1/stats and /api/v1/dataset?limit=N in parallel, then filters
// + dedups the dataset rows the same way the legacy public/index.html did.
//
// Dedup rule (matches server/stats-aggregate.mjs):
//   - filter to type === "analysis" (ignore legacy "session"/"share" rows)
//   - sort by generated_at DESC
//   - keep the first occurrence of each install_id
// The result is "latest analysis per contributor".

const STATS_URL   = "/api/v1/stats";
const DATASET_URL = "/api/v1/dataset?limit=1000";

export async function fetchDashboard({ signal } = {}) {
  const [statsRes, dataRes] = await Promise.all([
    fetch(STATS_URL, { signal }),
    fetch(DATASET_URL, { signal }),
  ]);

  if (!statsRes.ok) {
    throw new Error(`/api/v1/stats: HTTP ${statsRes.status}`);
  }
  if (!dataRes.ok) {
    throw new Error(`/api/v1/dataset: HTTP ${dataRes.status}`);
  }

  const stats   = await statsRes.json();
  const dataset = await dataRes.json();

  const analyses = dedupAnalyses(dataset.data || []);
  return { stats, analyses, rawDataset: dataset };
}

export function dedupAnalyses(rows) {
  const onlyAnalyses = rows.filter((r) => r && r.type === "analysis");
  onlyAnalyses.sort((a, b) => {
    const ta = Date.parse(a.generated_at || 0);
    const tb = Date.parse(b.generated_at || 0);
    return tb - ta; // newest first
  });
  const seen = new Set();
  const out = [];
  for (const r of onlyAnalyses) {
    const key = r.install_id || "anon-no-install-id";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
