// web/src/AnalysisApp.jsx
// Top-level composition for the Deep Analysis page.

import React, { useEffect, useState } from "react";
import { fetchDashboard } from "./lib/api.js";
import { deriveMetrics } from "./lib/derive.js";
import {
  AnalysisNav, AnalysisLede, QuotaMechanics, CapacitySection,
  CacheSensitivitySection, SubstitutionSection, HypothesisDeepDive,
  AnalysisMethodology, Footer,
} from "./components/analysis-sections.jsx";

export default function AnalysisApp() {
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
        console.error("Failed to load analysis:", err);
        setState({ loading: false, error: err, metrics: null });
      }
    })();
    return () => ctrl.abort();
  }, []);

  if (state.loading) {
    return (
      <>
        <AnalysisNav />
        <div className="load-state">Loading analysis data…</div>
      </>
    );
  }

  if (state.error) {
    return (
      <>
        <AnalysisNav />
        <div className="load-state error">
          Could not load analysis data: {String(state.error.message || state.error)}
        </div>
      </>
    );
  }

  const m = state.metrics;

  return (
    <>
      <AnalysisNav />
      <AnalysisLede metrics={m} />
      <QuotaMechanics metrics={m} />
      <CapacitySection />
      <CacheSensitivitySection metrics={m} />
      <SubstitutionSection metrics={m} />
      <HypothesisDeepDive metrics={m} />
      <AnalysisMethodology />
      <Footer />
    </>
  );
}
