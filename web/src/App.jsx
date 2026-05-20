// web/src/App.jsx
//
// Top-level composition. Fetches /api/v1/stats + /api/v1/dataset on mount,
// derives every metric the page renders, and passes a single `metrics` object
// down to every section.

import React, { useEffect, useState } from "react";
import { fetchDashboard } from "./lib/api.js";
import { deriveMetrics } from "./lib/derive.js";
import {
  Nav, Lede, Proof, Findings, ValueBars, PlanTable, Advisory,
  TokenCost, ModelCosts, FiveX, CacheStory, Methodology, CTA, Footer,
} from "./components/sections.jsx";

export default function App() {
  const [state, setState] = useState({ loading: true, error: null, metrics: null });

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const dash = await fetchDashboard({ signal: ctrl.signal });
        const metrics = deriveMetrics(dash);
        setState({ loading: false, error: null, metrics });
      } catch (err) {
        if (err.name === "AbortError") return;
        console.error("Failed to load dashboard:", err);
        setState({ loading: false, error: err, metrics: null });
      }
    })();
    return () => ctrl.abort();
  }, []);

  if (state.loading) {
    return (
      <>
        <Nav />
        <div className="load-state">Loading community data…</div>
      </>
    );
  }

  if (state.error) {
    return (
      <>
        <Nav />
        <div className="load-state error">
          Could not load dashboard data: {String(state.error.message || state.error)}
        </div>
      </>
    );
  }

  const m = state.metrics;

  return (
    <>
      <Nav />
      <Lede metrics={m} />
      <Proof metrics={m} />
      <Findings metrics={m} />
      <ValueBars metrics={m} />
      <PlanTable metrics={m} />
      <Advisory metrics={m} />
      <TokenCost metrics={m} />
      <ModelCosts metrics={m} />
      <FiveX metrics={m} />
      <CacheStory metrics={m} />
      <Methodology />
      <CTA />
      <Footer />
    </>
  );
}
