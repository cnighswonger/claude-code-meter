// web/src/components/analysis-sections.jsx
// Section components for the Deep Analysis page.
// Reuses chart components from charts.jsx (dashboard) plus the
// analysis-specific charts in analysis-charts.jsx.

import React from "react";
import { fmtN } from "../lib/derive.js";
import { Footer } from "./sections.jsx";
import {
  CapacityScenarioChart, CacheSensitivityChart, QuotaWindowsChart,
  SubstitutionChart, HypothesisRangeChart,
} from "./analysis-charts.jsx";
import { getModelMetric, shortenModel } from "../lib/model-metrics.mjs";
import { EDITORIAL_COMPARISON_PAIR } from "../../../src/rates.mjs";

// ─── Nav (Deep Analysis active) ──────────────────────────────────────────
export function AnalysisNav() {
  return (
    <nav className="top">
      <div className="wrap-wide">
        <div className="brand">
          <span className="vsits">VSITS</span>
          <span className="slash">/</span>
          <span>Claude Code Meter</span>
        </div>
        <div className="links">
          <a href="/">Dashboard</a>
          <a className="active" href="#top">Deep Analysis</a>
          <a href="#method">Methodology</a>
          <a href="/api/v1/dataset">Open Data</a>
        </div>
        <div className="right">
          <a className="gh" href="https://github.com/cnighswonger/claude-code-meter">
            <span className="dot" />GitHub
          </a>
          <a className="btn-contrib" href="/#contribute">Contribute data</a>
        </div>
      </div>
    </nav>
  );
}

// ─── Lede ─────────────────────────────────────────────────────────────────
export function AnalysisLede({ metrics }) {
  const updated = metrics.latest.toISOString().slice(0, 10);
  return (
    <section className="lede" id="top">
      <div className="wrap-wide">
        <div className="eyebrow">
          <span className="live"><span className="d" />Open data</span>
          <span className="sep">·</span>
          <span>Methods &amp; modelling</span>
          <span className="sep">·</span>
          <span>{fmtN(metrics.totalApiCalls)} API calls</span>
          <span className="sep">·</span>
          <span>updated {updated}</span>
        </div>

        <h1 className="head">
          The dashboard tells you <em>what.</em> This page tells you{" "}
          <em>how the numbers were derived,</em> what they assume, and where they break.
        </h1>

        <p className="deck">
          Deeper modelling of Claude Code subscription economics: quota-window mechanics,
          token-capacity estimates, cache-rate sensitivity, model substitution math, and a
          hypothesis-vs-data treatment of the Opus 4.7 quota gap. Skip to{" "}
          <a className="link" href="#method">Methodology</a> for the data pipeline.
        </p>

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

// ─── Section 1: Quota mechanics ───────────────────────────────────────────
export function QuotaMechanics({ metrics }) {
  return (
    <section>
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">01</span>
          <span>Quota mechanics</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          Two concurrent quota windows. <em>Both can throttle you.</em>
        </h2>
        <p className="section-deck">
          Claude Code subscriptions are governed by two overlapping rate-limit
          windows. Understanding their interaction is a prerequisite to reading
          everything else on this page.
        </p>

        <div className="chart-card">
          <div className="chart-head">
            <div>
              <h3>Q5h vs Q7d · reset cadence</h3>
              <div className="sub">
                Reset interval per window, in hours. The Q7d budget is the harder ceiling;
                the Q5h is the noisier one.
              </div>
            </div>
            <div className="meta">cadence · not capacity</div>
          </div>
          <QuotaWindowsChart />
          <div className="disclaim" style={{ marginTop: 18 }}>
            <b>Q5h</b> resets on a rolling 5-hour basis. Burn it and you wait at most
            5 hours. <b>Q7d</b> resets weekly. Burn it on Monday and you wait until next
            Monday. The dashboard's <em>cost-per-turn</em> numbers describe the Q5h
            window; the <em>multipliers</em> describe Q7d-extrapolated value.
          </div>
        </div>

        <div className="chart-card" style={{ marginTop: 18 }}>
          <div className="chart-head">
            <div>
              <h3>The intercept tells you where the cost actually goes</h3>
              <div className="sub">
                OLS intercept = {metrics.olsCoefficients.intercept.toExponential(3)} Q5h/turn.
                Per-call overhead dominates the regression; token-mix coefficients are
                second-order. Cost-per-turn ≈ a constant + a tiny linear term.
              </div>
            </div>
            <div className="meta">R² = {metrics.rSquared.toFixed(4)}</div>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th>Component</th>
                <th className="num">Value</th>
                <th>What it means</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="tier">Intercept</td>
                <td className="num num-warn">{metrics.olsCoefficients.intercept.toExponential(3)} Q5h/turn</td>
                <td style={{ color: "var(--ink-2)" }}>Fixed per-call overhead — biggest driver of quota burn</td>
              </tr>
              <tr>
                <td className="tier">R² (fit quality)</td>
                <td className="num">{metrics.rSquared.toFixed(4)}</td>
                <td style={{ color: "var(--ink-2)" }}>Token mix only explains a small slice of variance — turn count rules</td>
              </tr>
              <tr>
                <td className="tier">Mean cost exponent</td>
                <td className="num">{metrics.meanExponent.toFixed(2)}</td>
                <td style={{ color: "var(--ink-2)" }}>
                  {metrics.meanExponent < 1
                    ? "Sub-linear in turn count — long sessions amortise overhead"
                    : "Super-linear — cost climbs faster than turn count"}
                </td>
              </tr>
              <tr>
                <td className="tier">Output-token correlation</td>
                <td className="num">{metrics.correlations.output.toFixed(3)}</td>
                <td style={{ color: "var(--ink-2)" }}>Weak — output volume is not the primary driver in this sample</td>
              </tr>
              <tr>
                <td className="tier">Cache-read correlation</td>
                <td className="num num-good">{metrics.correlations.cacheRead.toFixed(3)}</td>
                <td style={{ color: "var(--ink-2)" }}>Negative — more cache reads correlate with less Q5h burn</td>
              </tr>
            </tbody>
          </table>
          <div className="disclaim" style={{ marginTop: 14 }}>
            <b>Operational read:</b> coalesce calls where you can. A 10-turn conversation
            with rich context beats 10 isolated turns even if total tokens are similar,
            because the intercept fires once per call.
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Section 2: Capacity estimates ────────────────────────────────────────
export function CapacitySection() {
  const scenarios = [
    { name: "Optimised (99% cache)", kind: "val",
      data: [
        +(20  / 4.3 / 0.549).toFixed(2),
        +(100 / 4.3 / 0.549).toFixed(2),
        +(200 / 4.3 / 0.549).toFixed(2),
      ].map((v) => +(v / 1000).toFixed(2)) },
    { name: "Typical (90% cache)", kind: "info",
      data: [
        +(20  / 4.3 / 0.795).toFixed(2),
        +(100 / 4.3 / 0.795).toFixed(2),
        +(200 / 4.3 / 0.795).toFixed(2),
      ].map((v) => +(v / 1000).toFixed(2)) },
    { name: "No caching", kind: "bad",
      data: [
        +(20  / 4.3 / 5.5).toFixed(2),
        +(100 / 4.3 / 5.5).toFixed(2),
        +(200 / 4.3 / 5.5).toFixed(2),
      ].map((v) => +(v / 1000).toFixed(2)) },
  ];

  return (
    <section>
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">02</span>
          <span>Capacity estimates</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          How many tokens fit in a Q7d window. <em>Three cache scenarios, three plans.</em>
        </h2>
        <p className="section-deck">
          Estimates of weekly token capacity per tier, under three cache hit rates,
          using Opus 4.6 published rates as the cost surface. The order-of-magnitude
          difference between scenarios is the whole story.
        </p>

        <div className="chart-card">
          <div className="chart-head">
            <div>
              <h3>Weekly capacity by tier × cache scenario</h3>
              <div className="sub">
                Subscription price ÷ blended $/MTok ÷ 4.3 (weeks per month). The
                no-cache row is the worst case; the optimised row is what disciplined
                prompt structure unlocks.
              </div>
            </div>
            <div className="meta">Opus 4.6 rates · 2026-04-14</div>
          </div>
          <CapacityScenarioChart scenarios={scenarios} />
          <div className="disclaim" style={{ marginTop: 18 }}>
            <b>An order of magnitude.</b> Disciplined caching multiplies your tier's
            real capacity by roughly 10×. The plan tier you pick matters; the prompt
            structure inside it matters more.
          </div>
        </div>

        <div className="chart-card" style={{ marginTop: 18 }}>
          <div className="chart-head">
            <div>
              <h3>Scenarios in detail</h3>
              <div className="sub">Token mix per scenario and resulting blended $/MTok used in the chart above.</div>
            </div>
          </div>
          <table className="dt">
            <thead>
              <tr>
                <th>Scenario</th>
                <th className="num">Output</th>
                <th className="num">Cache read</th>
                <th className="num">Cache write</th>
                <th className="num">Input</th>
                <th className="num">Blended $/MTok</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="tier">Optimised</td>
                <td className="num">0.2%</td>
                <td className="num num-good">99%</td>
                <td className="num">0.1%</td>
                <td className="num">0.7%</td>
                <td className="num">$0.549</td>
              </tr>
              <tr>
                <td className="tier">Typical</td>
                <td className="num">0.2%</td>
                <td className="num">90%</td>
                <td className="num">1%</td>
                <td className="num">8.8%</td>
                <td className="num">$0.795</td>
              </tr>
              <tr>
                <td className="tier">No caching</td>
                <td className="num">0.2%</td>
                <td className="num num-bad">0%</td>
                <td className="num">0%</td>
                <td className="num">99.8%</td>
                <td className="num num-bad">$5.500</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// ─── Section 3: Cache sensitivity ─────────────────────────────────────────
export function CacheSensitivitySection({ metrics }) {
  const observed = Math.round(metrics.cacheSavingsPct);
  return (
    <section>
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">03</span>
          <span>Cache-rate sensitivity</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          Every percentage point of cache hit rate moves the bill <em>visibly.</em>
        </h2>
        <p className="section-deck">
          Blended $/MTok under Opus 4.6 rates as the cache hit rate varies from
          0% to 100%. The curve is steep enough that a 10-point drop from your
          observed rate has more dollar impact than picking a different plan tier.
        </p>

        <div className="chart-card">
          <div className="chart-head">
            <div>
              <h3>Blended cost vs cache hit rate</h3>
              <div className="sub">
                Holding workload mix constant. Vertical line marks observed rate ({observed}%).
              </div>
            </div>
            <div className="meta">Opus 4.6 · output 0.2% · cache_create 1%</div>
          </div>
          <CacheSensitivityChart />
          <div className="disclaim" style={{ marginTop: 18 }}>
            <b>Why this matters more than tier selection.</b> Moving from 88% to 95%
            cache savings recovers more dollar value than moving up a plan tier at
            the same workload. The optimisation order is: structure your prompts,
            then pick a plan.
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Section 4: Model substitution ────────────────────────────────────────
export function SubstitutionSection({ metrics }) {
  // Substitution endpoints come from EDITORIAL_COMPARISON_PAIR.
  // `expensive` is the premium model (Opus 4.7 by default); `cheaper` is
  // the value model (Haiku 4.5 by default). Change the pair constant to
  // retire/reshape the editorial story without touching this component.
  const expensiveCost = getModelMetric(metrics, EDITORIAL_COMPARISON_PAIR.expensive, "modelCostPerTurn");
  const cheaperCost = getModelMetric(metrics, EDITORIAL_COMPARISON_PAIR.cheaper, "modelCostPerTurn");
  if (expensiveCost === 0 || cheaperCost === 0) return null;
  const fullSwap = Math.round((1 - cheaperCost / expensiveCost) * 100);
  const expensiveLabel = shortenModel(EDITORIAL_COMPARISON_PAIR.expensive);
  const cheaperLabel = shortenModel(EDITORIAL_COMPARISON_PAIR.cheaper);

  return (
    <section>
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">04</span>
          <span>Model substitution</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          Routing half your turns to {cheaperLabel} <em>cuts API cost roughly in half.</em>
        </h2>
        <p className="section-deck">
          Hypothetical: substitute {cheaperLabel} for {expensiveLabel} on a fraction of turns.
          {" "}{expensiveLabel} costs <b style={{ color: "var(--ink)" }}>${expensiveCost.toFixed(4)}</b>/turn;
          {" "}{cheaperLabel} costs <b style={{ color: "var(--ink)" }}>${cheaperCost.toFixed(4)}</b>/turn —
          a {fullSwap}% reduction at full swap. Cheap models route, expensive models think.
        </p>

        <div className="chart-card">
          <div className="chart-head">
            <div>
              <h3>Average $/turn at varying {cheaperLabel} share</h3>
              <div className="sub">
                Cost falls linearly with {cheaperLabel} substitution. Quality concerns are
                workload-dependent — measure before adopting any specific ratio.
              </div>
            </div>
            <div className="meta">{expensiveLabel} baseline ({fullSwap}% headroom)</div>
          </div>
          <SubstitutionChart modelCostPerTurn={metrics.modelCostPerTurn} />
          <div className="disclaim" style={{ marginTop: 18 }}>
            <b>Implementation pattern:</b> route by intent. Tool-routing, simple
            file edits, and search calls go to Haiku; reasoning-heavy work goes to
            Opus. The 50/50 split is a reasonable starting point in measured agentic
            workloads.
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Section 5: Opus 4.7 hypothesis deep-dive ─────────────────────────────
export function HypothesisDeepDive({ metrics }) {
  const opus46 = metrics.modelSplits["claude-opus-4-6"]?.avg_q5h_per_turn || 0;
  const opus47 = metrics.modelSplits["claude-opus-4-7"]?.avg_q5h_per_turn || 0;
  const observedRatio = opus46 > 0 ? opus47 / opus46 : null;

  return (
    <section>
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">05</span>
          <span>Opus 4.7 hypothesis · deep dive</span>
          <span className="rule" />
        </div>
        <h2 className="head">
          The hypothesis quantified: <em>how much hidden thinking would have to exist</em>
          {" "}for the ~2.4× claim to hold?
        </h2>
        <p className="section-deck">
          The dashboard flags the Opus 4.7 hidden-token hypothesis as unconfirmed.
          Here is the quantitative shape of the bet: if any fraction of 4.7's tokens are
          silently billed against quota but not reported in the API <code style={{ fontFamily: "var(--f-mono)", fontSize: ".9em", color: "var(--ink)" }}>usage</code>{" "}
          object, the effective Q5h-per-visible-token ratio rises sharply.
        </p>

        <div className="chart-card">
          <div className="chart-head">
            <div>
              <h3>Effective ratio under varying hidden-token share</h3>
              <div className="sub">
                Observed visible-token ratio = <b style={{ color: "var(--ink)" }}>{observedRatio !== null ? observedRatio.toFixed(2) + "×" : "insufficient sample"}</b>.
                Curve = observed ÷ (1 − hidden share). The hypothesis ratio of 2.4× is
                reached when {observedRatio !== null ? `~${Math.round((1 - observedRatio / 2.4) * 100)}%` : "~"} of tokens are hidden — a strong claim.
              </div>
            </div>
            <div className="meta">model · not measurement</div>
          </div>
          {observedRatio !== null && <HypothesisRangeChart observedRatio={observedRatio} />}
          <div className="disclaim" style={{ marginTop: 18 }}>
            <b>What would falsify the hypothesis.</b> An Anthropic-side surface that
            reports thinking-token counts (analogous to OpenAI's reasoning_tokens
            field) would either confirm or kill this hypothesis cleanly. Until then,
            we treat the dashboard's 2.4× as a labelled hypothesis.
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Section 6: Methodology ───────────────────────────────────────────────
export function AnalysisMethodology() {
  const code = { fontFamily: "var(--f-mono)", fontSize: ".9em", color: "var(--ink)" };
  return (
    <section id="method">
      <div className="wrap-wide">
        <div className="section-eye">
          <span className="num">06</span>
          <span>Methodology &amp; limits</span>
          <span className="rule" />
        </div>
        <h2 className="head">Where every number on this page comes from.</h2>

        <div className="methods">
          <div>
            <h3>The data pipeline</h3>
            <p>
              <a className="link" href="https://github.com/cnighswonger/claude-code-cache-fix">claude-code-cache-fix</a>{" "}
              sits as a local proxy between Claude Code and Anthropic. Response bodies
              are cloned via <code style={code}>response.clone()</code>; the clone is
              drained for the <code style={code}>usage</code> object and rate-limit
              headers. Token counts, cache TTL tier, Q5h/Q7d utilisation, and the
              undocumented <code style={code}>fallback_percentage</code> scalar are
              appended to a JSONL log. Prompts and completions never leave the host.
            </p>
            <p>
              <a className="link" href="https://www.npmjs.com/package/claude-code-meter">claude-meter</a>{" "}
              reads that log and runs the regressions. OLS coefficients, Pearson
              correlations, cumulative cost exponents, per-model splits, peak/off-peak
              splits all aggregate over the local store. Each row is Zod-validated;
              unknown fields are rejected on both client and server.
            </p>
            <h3 style={{ marginTop: 22 }}>What this page assumes</h3>
            <p>
              Capacity estimates use Anthropic's published per-token rates as the
              cost surface (Opus 4.6 unless noted) and assume the observed cache hit
              rate is representative of the scenario being modelled. The
              "blended $/MTok" line in §3 uses an idealised token mix; real workloads
              will scatter around it.
            </p>
            <p>
              The Opus 4.7 hypothesis chart in §5 assumes the simplest possible
              hidden-token model: <em>visible tokens</em> = (1 − hidden) × <em>total tokens</em>,
              with billing proportional to total. Real hidden-token accounting may
              be path-dependent; treat the curve as illustrative.
            </p>
          </div>

          <div className="limits">
            <h3>What this page is not</h3>
            <ul style={{ paddingLeft: 0, marginTop: 12 }}>
              <li>
                <b style={{ color: "var(--ink)" }}>Not a billing audit.</b> Anthropic
                does not bill subscriptions per-token. Numbers here show opportunity
                cost relative to the published API rate sheet, not invoices.
              </li>
              <li>
                <b style={{ color: "var(--ink)" }}>Not contractual.</b> Quota windows,
                cache TTLs, and rate-limit thresholds are reverse-engineered from
                observed behaviour. Anthropic can change any of them without notice.
              </li>
              <li>
                <b style={{ color: "var(--ink)" }}>Not generalisable from N=1.</b>{" "}
                Magnitudes shift with workload. Use the regression methodology — not
                the magnitudes — on your own data.
              </li>
              <li>
                <b style={{ color: "var(--ink)" }}>Not financial advice.</b> Verify
                any plan-selection decision against your own measured usage. We
                accept the methodology cleanly; we do not warrant the magnitudes.
              </li>
              <li>
                <b style={{ color: "var(--ink)" }}>Not affiliated.</b> This is
                community research. Anthropic has not reviewed these numbers and
                does not endorse them.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

export { Footer };
