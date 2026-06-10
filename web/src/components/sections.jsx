// web/src/components/sections.jsx
//
// All section components for the dashboard. Each takes the derived `metrics`
// prop (when it needs data) and renders one section of the page.
//
// Editorial copy lives in here. Numbers come from `metrics`. Static editorial
// constants that need operator review (e.g. the Opus 4.7 advisory multiplier
// until the API exposes it) come from lib/derive.js → OPUS_47_ADVISORY.

import React, { useEffect, useRef, useState } from "react";
import { fmt$, fmtN, fmtPct } from "../lib/derive.js";
import {
  SubscriptionValueChart, MultiplierChart, TokenCostChart, ModelCostChart,
  PeakOffPeakChart, Opus47Chart, CacheGauge, SavingsWaterfall,
} from "./charts.jsx";
import { getModelMetric, shortenModel } from "../lib/model-metrics.mjs";
import { MODEL_BASELINE, EDITORIAL_COMPARISON_PAIR } from "../../../src/rates.mjs";

// ─── Animated counter ─────────────────────────────────────────────────────
function Counter({ value, prefix = "", suffix = "", duration = 1400,
                   format = (v) => v.toLocaleString() }) {
  const [n, setN] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    let raf;
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      const t0 = performance.now();
      const tick = (now) => {
        const k = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - k, 3);
        setN(value * eased);
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      obs.disconnect();
    }, { threshold: 0.3 });
    obs.observe(ref.current);
    return () => { obs.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [value, duration]);
  return <span ref={ref}>{prefix}{format(Math.round(n))}{suffix}</span>;
}

// ─── Nav ──────────────────────────────────────────────────────────────────
export function Nav() {
  return (
    <nav className="top">
      <div className="wrap-wide">
        <div className="brand">
          <span className="vsits">VSITS</span>
          <span className="slash">/</span>
          <span>Claude Code Meter</span>
        </div>
        <div className="links">
          <a className="active" href="#top">Dashboard</a>
          <a href="/analysis.html">Deep Analysis</a>
          <a href="#method">Methodology</a>
          <a href="/api/v1/dataset">Open Data</a>
        </div>
        <div className="right">
          <a className="gh" href="https://github.com/cnighswonger/claude-code-meter">
            <span className="dot" />GitHub
          </a>
          <a className="btn-contrib" href="#contribute">Contribute data</a>
        </div>
      </div>
    </nav>
  );
}

// ─── Lede ─────────────────────────────────────────────────────────────────
export function Lede({ metrics }) {
  const updated = metrics.latest.toISOString().slice(0, 10);
  const m20x = metrics.planMultipliers.max_20x;
  const m5x  = metrics.planMultipliers.max_5x;
  const showTierCaveat = !metrics.tierConfirmed;

  return (
    <section className="lede" id="top">
      <div className="wrap-wide">
        <div className="eyebrow">
          <span className="live"><span className="d" />Open data</span>
          <span className="sep">·</span>
          <span>{fmtN(metrics.totalApiCalls)} API calls</span>
          <span className="sep">·</span>
          <span>{metrics.daysObserved} days observed</span>
          <span className="sep">·</span>
          <span>updated {updated}</span>
        </div>

        <h1 className="head">
          Max 20x delivers <em>~{(m20x / m5x).toFixed(1)}× the value per dollar</em> of Pro and Max 5x —
          and that gap <em>widens with every cache hit.</em>
        </h1>

        <p className="deck">
          Community-contributed metering of Claude Code subscriptions, reverse-engineered
          from response headers and benchmarked against published API rates. Every chart
          on this page derives from the open dataset below — what each token type really
          costs against quota, how the tiers compare, and where the cliffs are.
        </p>

        {showTierCaveat && (
          <p className="deck" style={{
            fontSize: 13.5, color: "var(--muted)", fontFamily: "var(--f-mono)",
            lineHeight: 1.55, borderLeft: "2px solid var(--warn)",
            paddingLeft: 12, marginTop: -8, marginBottom: 22,
          }}>
            <b style={{ color: "var(--warn)" }}>caveat:</b> the only contributor has
            <code style={{ color: "var(--ink)" }}> plan_tier:"unknown"</code>. Multipliers
            below assume <b style={{ color: "var(--ink)" }}>Max 5x</b>. Confirm with the
            operator or your own data before treating as actionable.
          </p>
        )}

        <div className="byline">
          <b>Veritas Supera IT Solutions</b>
          <span className="sep">·</span>
          Updated <b>{updated}</b>
          <span className="sep">·</span>
          Rates verified against <a className="link" href="https://platform.claude.com/docs/en/docs/about-claude/pricing">platform.claude.com/docs</a>
        </div>
      </div>
    </section>
  );
}

// ─── Proof strip ──────────────────────────────────────────────────────────
export function Proof({ metrics }) {
  const start = metrics.earliest.toISOString().slice(0, 10);
  const end   = metrics.latest.toISOString().slice(0, 10);
  return (
    <section className="proof">
      <div className="wrap-wide">
        <div className="proof-row">
          <div className="proof-cell">
            <span className="k">Contributors</span>
            <span className={"v " + (metrics.contributors < 5 ? "warn" : "")}>
              <Counter value={metrics.contributors} />
            </span>
            <span className="sub">
              {metrics.contributors === 1
                ? "single sustained-use account so far"
                : `aggregated across ${metrics.contributors} contributors`}
            </span>
          </div>
          <div className="proof-cell">
            <span className="k">API calls metered</span>
            <span className="v"><Counter value={metrics.totalApiCalls} /></span>
            <span className="sub">across {fmtN(metrics.totalSessions)} sessions</span>
          </div>
          <div className="proof-cell">
            <span className="k">Days observed</span>
            <span className="v"><Counter value={metrics.daysObserved} /></span>
            <span className="sub">{start} → {end}</span>
          </div>
          <div className="proof-cell">
            <span className="k">API-equivalent value</span>
            <span className="v"><Counter value={Math.round(metrics.totalApiCost)} prefix="$" /></span>
            <span className="sub">for {fmt$(metrics.subscriptionCostPaid)} of subscription</span>
          </div>
        </div>
        <p className="proof-note">
          {metrics.contributors === 1 ? (
            <>
              <b style={{ color: "var(--ink-2)" }}>One contributor isn't a population.</b>{" "}
              Numbers here describe a single account observed continuously. The methodology
              generalises; the magnitudes won't, until more accounts contribute.{" "}
              <a className="link" href="#contribute">Add your usage →</a>
            </>
          ) : (
            <>
              <b style={{ color: "var(--ink-2)" }}>Methodology generalises; magnitudes vary.</b>{" "}
              These are means across {metrics.contributors} contributors. Individual workloads
              will differ.{" "}
              <a className="link" href="#contribute">Add yours →</a>
            </>
          )}
        </p>
      </div>
    </section>
  );
}

// ─── Findings cards ───────────────────────────────────────────────────────
export function Findings({ metrics }) {
  const m20x = metrics.planMultipliers.max_20x;
  const adv = metrics.advisory.burnMultiplier;
  const cache = Math.round(metrics.cacheSavingsPct);

  return (
    <section>
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">01</span>
          <span>The three findings</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          Three things this dataset already <em>tells us cleanly</em>.
        </h2>
        <p className="section-deck">
          Each is supported by the regression results below, all observed on community-contributed
          data with verified API rates. Read these first; the charts justify them.
        </p>

        <div className="findings">
          <div className="finding">
            <span className="tag val">● Value · Plan tier</span>
            <div className="big">{m20x.toFixed(0)}<span className="x">×</span></div>
            <div className="lbl">Max 20x · API value per $</div>
            <h3>Max 20x is the only tier with a real value premium.</h3>
            <p>
              Pro and Max 5x both return <b style={{ color: "var(--ink)" }}>{metrics.planMultipliers.max_5x.toFixed(1)}×</b>{" "}
              their subscription cost in API-equivalent value. Max 20x doubles that to{" "}
              <b style={{ color: "var(--ink)" }}>{m20x.toFixed(1)}×</b> at half the cost
              per unit of capacity. The 5× and 20× labels describe capacity, not value-per-dollar.
            </p>
            <div className="foot">
              <span>Pro = Max 5x = $20/× · Max 20x = $10/×</span>
              <a href="#plan-value">Detail →</a>
            </div>
          </div>

          <div className="finding">
            <span className="tag bad">▲ Hypothesis · Model selection</span>
            <div className="big">{adv}<span className="x">?</span></div>
            <div className="lbl">Opus 4.7 · Q5h burn vs 4.6 (unconfirmed)</div>
            <h3>Opus 4.7 may burn quota at ~{adv}× the rate of 4.6 — we can't prove it yet.</h3>
            <p>
              The visible per-turn metric in this dataset shows the opposite direction.
              Our hypothesis is that adaptive thinking tokens are billed against Q5h but
              not reported in the API <code style={{ fontFamily: "var(--f-mono)", fontSize: ".9em" }}>usage</code> response.
              Until Anthropic exposes a per-visible-token quota field, this stays a labeled
              hypothesis, not a finding.
            </p>
            <div className="foot">
              <span>Hypothesis · open issue</span>
              <a href="#advisory">Read more →</a>
            </div>
          </div>

          <div className="finding">
            <span className="tag warn">● Driver · Caching</span>
            <div className="big">{cache}<span className="x">%</span></div>
            <div className="lbl">Average cache savings</div>
            <h3>Cache hits, not plan tier, are the primary value driver.</h3>
            <p>
              The same workload costs <b style={{ color: "var(--ink)" }}>{fmt$(metrics.noCacheCost)}</b>{" "}
              at full API rate but only <b style={{ color: "var(--ink)" }}>{fmt$(metrics.totalApiCost)}</b>{" "}
              with observed cache hit rates. Prompt structure beats subscription tier by an order
              of magnitude.
            </p>
            <div className="foot">
              <span>Cache hit rate: {cache}% avg</span>
              <a href="#cache">Detail →</a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Subscription value chart ─────────────────────────────────────────────
export function ValueBars({ metrics }) {
  return (
    <section id="plan-value">
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">02</span>
          <span>Subscription value</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          What this usage <em>would have cost</em> at API rates, against what the plans actually charge.
        </h2>
        <p className="section-deck">
          Same {fmtN(metrics.totalApiCalls)} API calls, six different lenses. Linear scale
          on purpose — log would flatter the subscriptions; this shows them honestly as a
          rounding error against the value they unlock.
        </p>

        <div className="chart-card">
          <div className="chart-head">
            <div>
              <h3>API-equivalent cost vs subscription price</h3>
              <div className="sub">{metrics.daysObserved} days · {fmtN(metrics.totalApiCalls)} calls · rates verified at platform.claude.com/docs</div>
            </div>
            <div className="meta">USD · linear scale</div>
          </div>

          <SubscriptionValueChart metrics={metrics} />

          <div className="disclaim">
            <b>Note:</b> "API-equivalent" means what the same token mix would cost on
            platform.claude.com pay-per-use. Subscription billing is not the same as token
            billing; this comparison shows opportunity cost, not invoice.
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Plan multipliers table ───────────────────────────────────────────────
export function PlanTable({ metrics }) {
  const v = metrics.planValues;
  const m = metrics.planMultipliers;
  return (
    <section>
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">03</span>
          <span>What "5×" actually means</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          Anthropic markets Max 5x as "5× more usage than Pro." <em>The Pro baseline is undefined.</em>
        </h2>
        <p className="section-deck">
          Here is what the dataset can pin down. The 5× and 20× refer to capacity multipliers
          relative to Pro, not to value-per-dollar.
        </p>

        <div className="chart-card">
          <div className="chart-head">
            <div>
              <h3>Subscription value multipliers</h3>
              <div className="sub">
                How much API-equivalent value each tier delivers, scaled from the observed
                Max 5x account by the 1× : 5× : 20× capacity ratio.
              </div>
            </div>
            <div className="meta">{metrics.contributors === 1 ? "N=1" : `N=${metrics.contributors}`} · Max 5x base</div>
          </div>

          <MultiplierChart metrics={metrics} />

          <table className="dt" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Plan</th>
                <th className="num">Monthly</th>
                <th className="num">API-equiv. value</th>
                <th className="num">Value multiplier</th>
                <th className="num">Cost per ×</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="tier">Pro</td>
                <td className="num">$20</td>
                <td className="num num-good">{fmt$(v.pro)}</td>
                <td className="num num-warn">{m.pro.toFixed(1)}×</td>
                <td className="num">$20/×</td>
              </tr>
              <tr>
                <td className="tier">Max 5x</td>
                <td className="num">$100</td>
                <td className="num num-good">{fmt$(v.max_5x)}</td>
                <td className="num num-warn">{m.max_5x.toFixed(1)}×</td>
                <td className="num">$20/×</td>
              </tr>
              <tr>
                <td className="tier">Max 20x</td>
                <td className="num">$200</td>
                <td className="num num-good">{fmt$(v.max_20x)}</td>
                <td className="num num-warn">{m.max_20x.toFixed(1)}×</td>
                <td className="num">$10/×</td>
              </tr>
            </tbody>
          </table>

          <div className="disclaim">
            <b>Why are Pro and Max 5x the same multiplier?</b> Pro ($20) buys 1× capacity.
            Max 5x ($100) buys 5× — both cost $20 per unit of capacity, so the value
            multiplier is identical. Max 20x ($200) buys 20× at $10 per unit — half the
            cost per unit, making it the best value per dollar.
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Advisory ─────────────────────────────────────────────────────────────
export function Advisory({ metrics }) {
  const a = metrics.advisory;
  const opus46 = metrics.modelSplits["claude-opus-4-6"]?.avg_q5h_per_turn || 0;
  const opus47 = metrics.modelSplits["claude-opus-4-7"]?.avg_q5h_per_turn || 0;
  const visibleRatio = opus46 > 0 ? (opus47 / opus46) : null;

  return (
    <section id="advisory">
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">04</span>
          <span>Hypothesis under investigation</span>
          <span className="rule" />
        </div>
        <div className="advisory">
          <div className="tag"><span className="sigil" />Opus 4.7 hidden-token hypothesis</div>
          <h3>
            We <em>suspect</em> Opus 4.7 burns Q5h at ~{a.burnMultiplier}× the rate of 4.6 —
            <em>but the visible data doesn't show it.</em>
          </h3>
          <p>
            Per-turn Q5h drain in the deduped dataset reads{" "}
            {visibleRatio !== null ? (
              <>
                <b style={{ color: "var(--ink)" }}>{visibleRatio.toFixed(2)}×</b>{" "}
                for Opus 4.7 vs 4.6 — i.e. 4.7 currently looks <em>cheaper</em>, not more expensive.
              </>
            ) : (<>insufficient sample to compute.</>)}{" "}
            The hypothesis: Opus 4.7's adaptive thinking tokens are charged against quota
            but <em>not reported</em> in the API <code style={{ fontFamily: "var(--f-mono)", fontSize: ".9em", color: "var(--ink)" }}>usage</code>{" "}
            response, so each visible token “costs more” than it appears. We can't confirm
            this from the current data — it requires a per-visible-token quota field the
            API doesn't expose yet. The chart below is illustrative, not measured.
          </p>
          <Opus47Chart metrics={metrics} />
          <div style={{ display: "flex", gap: 14, marginTop: 18, fontSize: 13, color: "var(--muted)" }}>
            <a className="link" href="https://github.com/cnighswonger/claude-code-meter/issues">Track the open issue →</a>
            <a className="link" href="https://github.com/cnighswonger/claude-code-meter">Methodology →</a>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── OLS regression ───────────────────────────────────────────────────────
export function TokenCost({ metrics }) {
  const c = metrics.olsCoefficients;
  const corr = metrics.correlations;
  const rows = [
    { type: "output",         coef: c.output,        pearson: corr.output,        color: "var(--warn)" },
    { type: "cache_creation", coef: c.cacheCreation, pearson: corr.cacheCreation, color: "var(--val)" },
    { type: "cache_read",     coef: c.cacheRead,     pearson: corr.cacheRead,     color: "var(--info)" },
    { type: "input",          coef: c.input,         pearson: corr.input,         color: "var(--bad)" },
  ];
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.coef)));
  return (
    <section>
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">05</span>
          <span>OLS regression</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          What each token type <em>actually costs</em> against your Q5h quota.
        </h2>
        <p className="section-deck">
          OLS coefficients per token type, fit against observed Q5h drain per turn.
          Higher = more expensive against quota.
        </p>

        <div className="chart-card">
          <div className="chart-head">
            <div>
              <h3>Q5h cost per token type</h3>
              <div className="sub">
                Coefficients from least-squares fit on {fmtN(metrics.totalApiCalls)} calls.
                R² = {metrics.rSquared.toFixed(4)} (cost-per-turn is dominated by per-call
                overhead, not by token mix — see intercept).
              </div>
            </div>
            <div className="meta">
              {metrics.contributors === 1 ? "N=1 contributor" : `N=${metrics.contributors} contributors`}
              {" "}· {fmtN(metrics.totalSessions)} sessions
            </div>
          </div>

          <TokenCostChart metrics={metrics} />

          <table className="dt" style={{ marginTop: 22 }}>
            <thead>
              <tr>
                <th>Token type</th>
                <th className="num">Q5h / token</th>
                <th className="num">Relative magnitude</th>
                <th className="num">Pearson r</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.type}>
                  <td className="tier" style={{ fontFamily: "var(--f-mono)", fontSize: 13 }}>{r.type}</td>
                  <td className="num">{r.coef.toExponential(3)}</td>
                  <td className="num">
                    <span style={{ color: r.color }}>
                      {Math.round((Math.abs(r.coef) / maxAbs) * 100)}%
                    </span>
                  </td>
                  <td className="num">{r.pearson.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="disclaim">
            <b>Intercept = {metrics.olsCoefficients.intercept.toExponential(3)} Q5h/turn.</b>{" "}
            That's the fixed per-call overhead — the largest single driver of quota burn.
            Token mix matters less than turn count. Coalesce calls where you can.
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Per-model + peak/off-peak ────────────────────────────────────────────
export function ModelCosts({ metrics }) {
  // Note: opus46/opus47 here are part of the Opus 4.7 hidden-token advisory
  // story (sections.jsx:530, :533-535). Editorial content, not configurable
  // labels. Stays hardcoded.
  const opus46 = metrics.modelCostPerTurn["claude-opus-4-6"] || 0;
  const opus47 = metrics.modelCostPerTurn["claude-opus-4-7"] || 0;
  const delta = opus46 > 0 ? Math.round((opus47 / opus46 - 1) * 100) : 0;
  // Editorial comparison-pair: configurable via EDITORIAL_COMPARISON_PAIR.
  const cheaperCost = getModelMetric(metrics, EDITORIAL_COMPARISON_PAIR.cheaper, "modelCostPerTurn");
  const expensiveCost = getModelMetric(metrics, EDITORIAL_COMPARISON_PAIR.expensive, "modelCostPerTurn");
  const cheaperLabel = shortenModel(EDITORIAL_COMPARISON_PAIR.cheaper);
  const expensiveLabel = shortenModel(EDITORIAL_COMPARISON_PAIR.expensive);
  const baselineLabel = shortenModel(MODEL_BASELINE);

  return (
    <section>
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">06</span>
          <span>Per-model cost</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          Opus 4.7 is the most expensive turn in the catalog. <em>By a lot.</em>
        </h2>
        <p className="section-deck">
          API cost per turn, in USD, across the models observed in the dataset. Opus 4.7 sits
          {" "}{delta >= 0 ? "~" : "-"}{Math.abs(delta)}% above 4.6 at the API layer alone — before the
          additional Q5h penalty above.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
          <div className="chart-card">
            <div className="chart-head">
              <div>
                <h3>API cost per turn · by model</h3>
                <div className="sub">USD per conversational turn, ordered low to high. Bars annotated against the {baselineLabel} baseline.</div>
              </div>
            </div>
            <ModelCostChart metrics={metrics} />
            <div className="disclaim">
              <b>{cheaperLabel}</b> is {expensiveCost > 0 && cheaperCost > 0
                ? `~${Math.round(expensiveCost / cheaperCost)}× cheaper`
                : "much cheaper"}{" "}
              per turn than {expensiveLabel} and a reasonable default for tool-routing and simple
              completions.
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-head">
              <div>
                <h3>Peak vs off-peak · Q5h per turn</h3>
                <div className="sub">Drain by hour-of-day bucket. Anthropic does not document a peak/off-peak differential.</div>
              </div>
            </div>
            <PeakOffPeakChart metrics={metrics} />
            <div className="disclaim">
              <b>Delta: {metrics.peakOffPeak.peak > 0 && metrics.peakOffPeak.offpeak > 0
                ? `${Math.round((metrics.peakOffPeak.peak / metrics.peakOffPeak.offpeak - 1) * 100)}%`
                : "—"} peak vs off-peak.</b> Within noise — likely reflects which prompts get
              sent when, not a billing differential. Don't time your code around it.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── "5× decoded" table ───────────────────────────────────────────────────
export function FiveX({ metrics }) {
  return (
    <section>
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">07</span>
          <span>The "5×" decoded</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          The metrics behind <em>"5× more usage than Pro."</em>
        </h2>

        <div className="chart-card">
          <div className="chart-head">
            <div>
              <h3>Observed values · {metrics.daysObserved}-day window</h3>
              <div className="sub">Every row is a number this dataset can produce. Marketing copy is not.</div>
            </div>
            <div className="meta">{metrics.plan ? metrics.plan.monthly === 100 ? "Max 5x" : `$${metrics.plan.monthly}/mo` : "—"} · {metrics.contributors === 1 ? "single account" : `${metrics.contributors} accounts`}</div>
          </div>

          <table className="dt">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="num">Observed</th>
                <th>Implication</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="tier">API-equivalent cost ({metrics.daysObserved} days)</td>
                <td className="num num-good">{fmt$(metrics.totalApiCost)}</td>
                <td style={{ color: "var(--ink-2)" }}>What this usage would cost at pay-per-use</td>
              </tr>
              <tr>
                <td className="tier">Subscription cost ({metrics.daysObserved} days)</td>
                <td className="num num-good">{fmt$(metrics.subscriptionCostPaid)}</td>
                <td style={{ color: "var(--ink-2)" }}>What the plan actually cost for this period</td>
              </tr>
              <tr>
                <td className="tier">Effective multiplier</td>
                <td className="num num-warn">{metrics.effectiveMultiplier.toFixed(1)}×</td>
                <td style={{ color: "var(--ink-2)" }}>API value ÷ subscription cost</td>
              </tr>
              {metrics.fallbackPct !== null && (
                <tr>
                  <td className="tier">fallback_percentage header</td>
                  <td className="num num-warn">{metrics.fallbackPct}</td>
                  <td style={{ color: "var(--ink-2)" }}>Undocumented per-account scalar, static, observed on every call</td>
                </tr>
              )}
              <tr>
                <td className="tier">Cache hit rate (avg)</td>
                <td className="num num-good">{Math.round(metrics.cacheSavingsPct)}%</td>
                <td style={{ color: "var(--ink-2)" }}>Cache optimization is the primary value driver</td>
              </tr>
              <tr>
                <td className="tier">Cost exponent (mean)</td>
                <td className="num">{metrics.meanExponent.toFixed(2)}</td>
                <td style={{ color: "var(--ink-2)" }}>
                  {metrics.meanExponent < 1 ? "Sub-linear — cost per turn is stable" :
                   metrics.meanExponent > 1 ? "Super-linear — cost climbs faster than turn count" :
                   "Linear — cost per turn is stable"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ─── Cache story ──────────────────────────────────────────────────────────
export function CacheStory({ metrics }) {
  const realised = Math.round(metrics.totalApiCost - metrics.subscriptionCostPaid);
  return (
    <section id="cache">
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">08</span>
          <span>Where the value actually comes from</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          {Math.round(metrics.cacheSavingsPct)}% of the dollar value is from <em>prompt caching</em>, not the plan tier.
        </h2>
        <p className="section-deck">
          The Pro/Max/Max 20× multiplier difference is real, but it's a second-order effect.
          Whether your prompts cache is the first-order one. Same workload, two scenarios —
          one cached, one not.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 24 }}>
          <div className="chart-card" style={{ display: "flex", flexDirection: "column" }}>
            <div className="chart-head" style={{ marginBottom: 0 }}>
              <div>
                <h3>Cache hit rate · observed</h3>
                <div className="sub">{metrics.daysObserved}-day rolling average across all turns.</div>
              </div>
            </div>
            <CacheGauge metrics={metrics} />
            <div className="disclaim" style={{ marginTop: "auto" }}>
              <b>Pin your system prompt.</b> Hit rates above 80% require structurally
              cache-friendly prompts — same prefix, stable tool definitions, files appended
              not prepended.
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-head">
              <div>
                <h3>Where the {fmt$(metrics.noCacheCost)} went</h3>
                <div className="sub">
                  Same {fmtN(metrics.totalApiCalls)} calls, before and after caching, against
                  actual plan paid.
                </div>
              </div>
              <div className="meta">{metrics.daysObserved} days · {metrics.plan ? metrics.plan.monthly === 100 ? "Max 5x" : `$${metrics.plan.monthly}/mo` : "—"}</div>
            </div>
            <SavingsWaterfall metrics={metrics} />
            <div className="disclaim">
              <b>{fmt$(realised)} of net value</b> on {fmt$(metrics.subscriptionCostPaid)} of
              subscription. Cache savings alone are {metrics.subscriptionCostPaid > 0
                ? `~${(metrics.cacheSavingsSum / metrics.subscriptionCostPaid).toFixed(1)}×`
                : "many ×"} the realised value — turn caching off and the subscription
              instantly looks expensive.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Methodology ──────────────────────────────────────────────────────────
export function Methodology() {
  const code = { fontFamily: "var(--f-mono)", fontSize: ".9em", color: "var(--ink)" };
  return (
    <section id="method">
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">09</span>
          <span>Methodology &amp; limits</span>
          <span className="rule" />
        </div>
        <h2 className="head">How we got these numbers — and where they break.</h2>

        <div className="methods">
          <div>
            <h3>How the data is collected</h3>
            <p>
              The{" "}
              <a className="link" href="https://github.com/cnighswonger/claude-code-cache-fix">claude-code-cache-fix</a>{" "}
              proxy intercepts Claude Code API responses using <code style={code}>response.clone()</code> —
              the original passes through untouched, the clone is drained for the
              <code style={code}> usage</code> object and rate-limit headers. Token counts,
              cache-TTL tier, Q5h / Q7d utilisation, and the <code style={code}>fallback_percentage</code>{" "}
              scalar get appended to <code style={code}>~/.claude/claude-meter.jsonl</code>.
              The interceptor never touches request bodies — structurally can't leak prompts.
            </p>
            <p>
              <b style={{ color: "var(--ink)" }}>claude-meter analyze</b> runs OLS regression
              over your local log and produces a Zod-validated JSON summary: R², coefficients
              per token type, Pearson correlations, model splits, peak/off-peak averages.
              No per-turn rows in the share payload — only aggregates. Inspect the exact
              payload before transmission with{" "}
              <code style={code}>claude-meter analyze --share --dry-run</code>.
            </p>
            <h3 style={{ marginTop: 22 }}>Public API</h3>
            <p>
              The dataset is open. Pull aggregate stats, download the full anonymised
              dataset, or post your own analysis:
            </p>
            <ul style={{ paddingLeft: 0, margin: "0 0 14px", listStyle: "none" }}>
              <li style={apiLine}><span style={{ color: "var(--val)" }}>GET </span>/api/v1/dataset<span style={{ color: "var(--muted)" }}>  — full anonymised dataset</span></li>
              <li style={apiLine}><span style={{ color: "var(--val)" }}>GET </span>/api/v1/stats<span style={{ color: "var(--muted)" }}>    — aggregate statistics</span></li>
              <li style={apiLine}><span style={{ color: "var(--val)" }}>GET </span>/api/v1/schema<span style={{ color: "var(--muted)" }}>   — current accepted schema</span></li>
              <li style={apiLine}><span style={{ color: "var(--info)" }}>POST</span> /api/v1/submit<span style={{ color: "var(--muted)" }}>   — submit your analysis summary</span></li>
              <li style={apiLine}><span style={{ color: "var(--info)" }}>POST</span> /api/v1/register<span style={{ color: "var(--muted)" }}> — generate a write API key</span></li>
            </ul>
            <p style={{ fontSize: 12.5, color: "var(--muted)" }}>
              Rate limits: 10 submissions/day anonymous, 100/day with API key.
            </p>
          </div>

          <div className="limits">
            <h3>What you should not conclude</h3>
            <ul style={{ paddingLeft: 0, marginTop: 12 }}>
              <li>
                <b style={{ color: "var(--ink)" }}>Small sample.</b> The dataset reflects a
                handful of contributors so far. Magnitudes vary by workload — cache hit rate,
                turn length, and model mix all move the numbers.
              </li>
              <li>
                <b style={{ color: "var(--ink)" }}>"API-equivalent" ≠ "what you'd pay."</b>{" "}
                Anthropic does not bill subscriptions as token-metered. The comparison shows
                opportunity cost, not invoice.
              </li>
              <li>
                <b style={{ color: "var(--ink)" }}>Reverse-engineered.</b> Quota internals
                aren't documented. Coefficients change when Anthropic ships pricing or model
                updates.
              </li>
              <li>
                <b style={{ color: "var(--ink)" }}>No affiliation.</b> This is community
                research. Anthropic has not reviewed these numbers; treat them as
                hypotheses, not invoices.
              </li>
              <li>
                <b style={{ color: "var(--ink)" }}>Not financial advice.</b> Verify any
                plan-selection decision against your own usage before purchasing.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

const apiLine = {
  fontFamily: "var(--f-mono)", fontSize: 12.5, color: "var(--ink-2)", padding: "4px 0",
};

// ─── CTA ──────────────────────────────────────────────────────────────────
export function CTA() {
  return (
    <section className="cta" id="contribute">
      <div className="wrap-wide">
        <div className="cta-card">
          <div>
            <h3>One contributor isn't enough. <em>Add yours.</em></h3>
            <p>
              Two npm packages, a proxy service, and one consent flag. Your account joins
              the dataset within minutes — only aggregate statistics leave your machine,
              never prompts or completions.
            </p>
            <div className="cta-actions">
              <a className="btn btn-primary" href="https://github.com/cnighswonger/claude-code-meter">
                Read the docs
              </a>
              <a className="btn btn-ghost" href="https://github.com/cnighswonger/claude-code-meter">
                View on GitHub
              </a>
              <a className="btn btn-ghost" href="/api/v1/dataset">
                Download dataset
              </a>
            </div>
          </div>
          <div className="right">
            <pre>
<span className="cmt"># 1 — install the cache-fix proxy (collector)</span>{"\n"}
<span className="pfx">$</span> npm install -g <span className="arg">claude-code-cache-fix</span>{"\n"}
<span className="pfx">$</span> cache-fix-proxy <span className="arg">install-service</span>{"\n\n"}
<span className="cmt"># 2 — install claude-code-meter</span>{"\n"}
<span className="pfx">$</span> npm install -g <span className="arg">claude-code-meter</span>{"\n"}
<span className="pfx">$</span> claude-meter ingest <span className="arg">--watch</span>{"\n\n"}
<span className="cmt"># 3 — analyze + (optionally) share</span>{"\n"}
<span className="pfx">$</span> claude-meter analyze <span className="arg">--share</span>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────
export function Footer() {
  return (
    <footer className="bottom">
      <div className="wrap-wide">
        <div className="colophon">
          <b>Veritas Supera IT Solutions</b> · Open data, open analysis, MIT licensed.
          Not affiliated with, endorsed by, or supported by Anthropic PBC.
          The data on this page describes a small community-contributed sample and is
          published to advance community understanding of Claude Code subscription economics.
        </div>
        <div className="links2">
          <a href="https://github.com/cnighswonger/claude-code-meter">GitHub</a>
          <a href="/api/v1/dataset">Raw dataset</a>
          <a href="#method">Methodology</a>
          <a href="https://www.npmjs.com/package/claude-code-meter">npm</a>
          <a href="/api/v1/schema">Schema</a>
          <a href="https://github.com/cnighswonger/claude-code-cache-fix">cache-fix-proxy</a>
        </div>
      </div>
    </footer>
  );
}
