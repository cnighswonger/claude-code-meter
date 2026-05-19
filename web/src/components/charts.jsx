// web/src/components/charts.jsx
//
// All Highcharts components. Each takes the derived `metrics` object (or a
// subset of it) and produces a single chart inside the shared <Chart>
// wrapper. To replace Highcharts (see LICENSING.md Option C), this file
// is the second one you change after lib/chartBase.jsx.

import React from "react";
import { Chart, gradient, gradientH, colorWithAlpha } from "../lib/chartBase.jsx";

// ─── 1. Subscription value — horizontal bar ───────────────────────────────
export function SubscriptionValueChart({ metrics }) {
  const data = [
    { name: "Without caching",         y: metrics.noCacheCost,         kind: "bad"  },
    { name: "With caching (API rate)", y: metrics.totalApiCost,        kind: "info" },
    { name: "Monthly projection",      y: metrics.monthlyProjection,   kind: "info" },
    { name: "Max 20x ($200/mo)",       y: 200,                          kind: "val"  },
    { name: "Max 5x ($100/mo)",        y: 100,                          kind: "val"  },
    { name: "Pro ($20/mo)",            y: 20,                           kind: "val"  },
  ];
  return (
    <Chart
      height={420}
      deps={[metrics.noCacheCost, metrics.totalApiCost, metrics.monthlyProjection]}
      build={(t, base) => {
        const colorFor = (kind) =>
          kind === "bad"  ? gradientH(colorWithAlpha(t.bad,  0.95), colorWithAlpha(t.bad,  0.55)) :
          kind === "info" ? gradientH(colorWithAlpha(t.info, 0.95), colorWithAlpha(t.info, 0.55)) :
                            gradientH(colorWithAlpha(t.val,  0.95), colorWithAlpha(t.val,  0.55));
        const points = data.map((d) => ({
          name: d.name,
          y: d.y,
          color: colorFor(d.kind),
          dataLabels: {
            enabled: true, inside: false, align: "left", x: 8,
            format: "${y:,.0f}",
            style: { color: t.ink, textOutline: "none" },
          },
        }));
        return {
          ...base,
          chart: { ...base.chart, type: "bar", height: 420, spacingLeft: 0 },
          xAxis: {
            ...base.xAxis,
            categories: data.map((d) => d.name),
            lineWidth: 0, tickLength: 0,
            labels: { ...base.xAxis.labels,
              style: { ...base.xAxis.labels.style,
                color: t.ink2, fontFamily: '"Geist", sans-serif', fontSize: "13px" } },
          },
          yAxis: {
            ...base.yAxis,
            title: { text: "USD", style: base.yAxis.title.style },
            labels: { ...base.yAxis.labels,
              formatter: function () { return "$" + (this.value / 1000) + "k"; } },
            min: 0,
            max: Math.max(...data.map((d) => d.y)) * 1.08,
            tickInterval: 10000,
          },
          tooltip: { ...base.tooltip,
            pointFormatter: function () {
              const c = this.color.stops ? this.color.stops[0][1] : this.color;
              return `<span style="color:${c};">●</span> <b style="font-family:'JetBrains Mono';">$${this.y.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b>`;
            } },
          legend: { enabled: false },
          plotOptions: { ...base.plotOptions,
            bar: { ...base.plotOptions.bar, dataLabels: { enabled: true },
                   pointPadding: 0.05, groupPadding: 0.08 } },
          series: [{ name: "USD", data: points }],
        };
      }}
    />
  );
}

// ─── 2. Value multiplier — bar ────────────────────────────────────────────
export function MultiplierChart({ metrics }) {
  const m = metrics.planMultipliers;
  return (
    <Chart
      height={260}
      deps={[m.pro, m.max_5x, m.max_20x]}
      build={(t, base) => ({
        ...base,
        chart: { ...base.chart, type: "bar", height: 260 },
        xAxis: { ...base.xAxis,
          categories: ["Pro ($20)", "Max 5x ($100)", "Max 20x ($200)"],
          lineWidth: 0, tickLength: 0,
          labels: { style: { color: t.ink2, fontFamily: '"Geist", sans-serif', fontSize: "13px" } } },
        yAxis: { ...base.yAxis,
          title: { text: "L(t) — subscription-leverage multiplier (API$ ÷ subscription$)",
                   style: { color: t.muted, fontFamily: '"JetBrains Mono"', fontSize: "10.5px",
                            letterSpacing: ".06em", textTransform: "uppercase" } },
          max: Math.max(m.pro, m.max_5x, m.max_20x) * 1.12,
          plotLines: [{ value: m.max_5x, width: 1, color: t.hairStr, dashStyle: "Dash",
            label: { text: "Pro / Max 5x baseline",
                     style: { color: t.muted, fontFamily: '"JetBrains Mono"', fontSize: "10px" },
                     align: "right", x: -10 }, zIndex: 5 }] },
        legend: { enabled: false },
        tooltip: { ...base.tooltip,
          pointFormatter: function () {
            return `<b style="font-family:'JetBrains Mono';">${this.y.toFixed(1)}×</b> value`;
          } },
        plotOptions: { ...base.plotOptions,
          bar: { ...base.plotOptions.bar,
            dataLabels: { enabled: true,
              formatter: function () { return this.y.toFixed(1) + "×"; },
              align: "right", inside: false, x: -4,
              style: { color: t.ink, fontFamily: '"Geist", sans-serif', fontSize: "16px",
                       fontWeight: "500", textOutline: "none" } },
            pointPadding: 0.05, groupPadding: 0.15 } },
        series: [{ name: "Multiplier",
          data: [
            { y: m.pro,     color: gradientH(colorWithAlpha(t.info, 0.85), colorWithAlpha(t.info, 0.5)) },
            { y: m.max_5x,  color: gradientH(colorWithAlpha(t.info, 0.85), colorWithAlpha(t.info, 0.5)) },
            { y: m.max_20x, color: gradientH(colorWithAlpha(t.accent, 0.95), colorWithAlpha(t.accent, 0.55)) },
          ] }],
      })}
    />
  );
}

// ─── 3. Token cost — diverging bar ────────────────────────────────────────
export function TokenCostChart({ metrics }) {
  const c = metrics.olsCoefficients;
  const data = [
    { name: "output",         y: c.output        * 1e7, kind: "warn" },
    { name: "cache_creation", y: c.cacheCreation * 1e7, kind: "val"  },
    { name: "cache_read",     y: c.cacheRead     * 1e7, kind: "info" },
    { name: "input",          y: c.input         * 1e7, kind: "bad"  },
  ];
  const span = Math.max(...data.map((d) => Math.abs(d.y))) * 1.2;
  return (
    <Chart
      height={280}
      deps={[c.output, c.cacheCreation, c.cacheRead, c.input]}
      build={(t, base) => ({
        ...base,
        chart: { ...base.chart, type: "bar", height: 280 },
        xAxis: { ...base.xAxis,
          categories: data.map((d) => d.name),
          lineWidth: 0, tickLength: 0,
          labels: { style: { color: t.ink2, fontFamily: '"JetBrains Mono"', fontSize: "12.5px" } } },
        yAxis: { ...base.yAxis,
          title: { text: "Q5h cost per token (×10⁻⁷)",
                   style: { color: t.muted, fontFamily: '"JetBrains Mono"', fontSize: "10.5px",
                            letterSpacing: ".06em", textTransform: "uppercase" } },
          plotLines: [{ value: 0, width: 1, color: t.hairStr, zIndex: 5 }],
          min: -span, max: span },
        legend: { enabled: false },
        tooltip: { ...base.tooltip,
          pointFormatter: function () {
            return `<b style="font-family:'JetBrains Mono';">${this.y > 0 ? "+" : ""}${this.y.toFixed(3)}e-7</b> Q5h / token`;
          } },
        plotOptions: { ...base.plotOptions,
          bar: { ...base.plotOptions.bar,
            dataLabels: { enabled: true,
              formatter: function () { return (this.y > 0 ? "+" : "") + this.y.toFixed(2) + "e-7"; },
              inside: false,
              style: { color: t.ink2, fontFamily: '"JetBrains Mono"', fontSize: "11px",
                       fontWeight: "500", textOutline: "none" } } } },
        series: [{ name: "Coefficient",
          data: data.map((d) => ({
            y: d.y,
            color: d.kind === "warn" ? gradientH(colorWithAlpha(t.warn, 0.55), colorWithAlpha(t.warn, 0.95)) :
                   d.kind === "val"  ? gradientH(colorWithAlpha(t.val,  0.55), colorWithAlpha(t.val,  0.95)) :
                   d.kind === "info" ? gradientH(colorWithAlpha(t.info, 0.95), colorWithAlpha(t.info, 0.55)) :
                                       gradientH(colorWithAlpha(t.bad,  0.95), colorWithAlpha(t.bad,  0.55)),
          })) }],
      })}
    />
  );
}

// ─── 4. Per-model cost — column ───────────────────────────────────────────
export function ModelCostChart({ metrics }) {
  // Order: cheap → expensive, matching the original editorial layout
  const labelOrder = ["claude-haiku-4-5", "claude-opus-4-6", "claude-sonnet-4-6", "claude-opus-4-7"];
  const colors = ["val", "info", "warn", "bad"];
  const data = labelOrder
    .map((m, i) => ({ name: shortenModel(m), y: metrics.modelCostPerTurn[m] || 0, kind: colors[i] }))
    .filter((d) => d.y > 0);
  const baseline = metrics.modelCostPerTurn["claude-opus-4-6"] || 0;

  return (
    <Chart
      height={320}
      deps={[JSON.stringify(metrics.modelCostPerTurn)]}
      build={(t, base) => ({
        ...base,
        chart: { ...base.chart, type: "column", height: 320 },
        xAxis: { ...base.xAxis,
          categories: data.map((d) => d.name),
          lineColor: t.hair,
          labels: { style: { color: t.ink2, fontFamily: '"JetBrains Mono"', fontSize: "12px" } } },
        yAxis: { ...base.yAxis,
          title: { text: "USD / turn",
                   style: { color: t.muted, fontFamily: '"JetBrains Mono"', fontSize: "10.5px",
                            letterSpacing: ".06em", textTransform: "uppercase" } },
          labels: { ...base.yAxis.labels,
            formatter: function () { return "$" + this.value.toFixed(2); } },
          min: 0,
          plotLines: baseline > 0 ? [{ value: baseline, color: t.hairStr,
            dashStyle: "Dash", width: 1, zIndex: 4,
            label: { text: "opus-4-6 baseline",
              style: { color: t.muted, fontFamily: '"JetBrains Mono"', fontSize: "10px" },
              align: "left", x: 8 } }] : [] },
        legend: { enabled: false },
        tooltip: { ...base.tooltip,
          pointFormatter: function () {
            const vsBase = baseline > 0 ? ((this.y / baseline - 1) * 100).toFixed(0) : "0";
            const sign = Number(vsBase) >= 0 ? "+" : "";
            return `<b style="font-family:'JetBrains Mono';">$${this.y.toFixed(4)}</b> / turn<br/>` +
                   `<span style="color:${t.muted};font-size:11px;">${sign}${vsBase}% vs opus-4-6</span>`;
          } },
        plotOptions: { ...base.plotOptions,
          column: { ...base.plotOptions.column,
            dataLabels: { enabled: true, format: "${y:.4f}",
              style: { color: t.ink, fontFamily: '"JetBrains Mono"', fontSize: "11.5px",
                       fontWeight: "500", textOutline: "none" }, y: -4 },
            pointPadding: 0.04, groupPadding: 0.18 } },
        series: [{ name: "Cost",
          data: data.map((d) => ({
            y: d.y,
            color: d.kind === "val"  ? gradient(colorWithAlpha(t.val,  0.95), colorWithAlpha(t.val,  0.4)) :
                   d.kind === "info" ? gradient(colorWithAlpha(t.info, 0.95), colorWithAlpha(t.info, 0.4)) :
                   d.kind === "warn" ? gradient(colorWithAlpha(t.warn, 0.95), colorWithAlpha(t.warn, 0.4)) :
                                       gradient(colorWithAlpha(t.bad,  0.95), colorWithAlpha(t.bad,  0.4)),
          })) }],
      })}
    />
  );
}

function shortenModel(m) {
  return m.replace(/^claude-/, "");
}

// ─── 5. Opus 4.7 paired column ────────────────────────────────────────────
export function Opus47Chart({ metrics }) {
  const a = metrics.advisory;
  return (
    <Chart
      height={240}
      deps={[a.burnMultiplier, a.apiCostMultiplier, a.toolCallMultiplier]}
      build={(t, base) => ({
        ...base,
        chart: { ...base.chart, type: "column", height: 240 },
        xAxis: { ...base.xAxis,
          categories: ["Q5h burn", "API $ / turn", "Tool-call cost"],
          lineColor: t.hair,
          labels: { style: { color: t.ink2, fontFamily: '"Geist", sans-serif', fontSize: "12px" } } },
        yAxis: { ...base.yAxis,
          title: { text: "Relative to Opus 4.6 (= 1.0×)",
                   style: { color: t.muted, fontFamily: '"JetBrains Mono"', fontSize: "10.5px",
                            letterSpacing: ".06em", textTransform: "uppercase" } },
          min: 0, max: Math.max(a.burnMultiplier, a.apiCostMultiplier, a.toolCallMultiplier) * 1.15,
          plotLines: [{ value: 1.0, width: 1, color: t.hairStr, dashStyle: "Dash", zIndex: 5,
            label: { text: "opus-4-6", style: { color: t.muted,
              fontFamily: '"JetBrains Mono"', fontSize: "10px" }, align: "right", x: -8 } }] },
        legend: { ...base.legend, align: "left", verticalAlign: "top",
          itemStyle: { ...base.legend.itemStyle, color: t.ink2 } },
        tooltip: { ...base.tooltip, shared: true },
        plotOptions: { ...base.plotOptions,
          column: { ...base.plotOptions.column,
            dataLabels: { enabled: true,
              formatter: function () { return this.y.toFixed(1) + "×"; },
              style: { color: t.ink, fontFamily: '"JetBrains Mono"', fontSize: "11.5px",
                       fontWeight: "500", textOutline: "none" }, y: -4 } } },
        series: [
          { name: "opus-4-6", data: [1.0, 1.0, 1.0],
            color: gradient(colorWithAlpha(t.info, 0.85), colorWithAlpha(t.info, 0.4)) },
          { name: "opus-4-7", data: [a.burnMultiplier, a.apiCostMultiplier, a.toolCallMultiplier],
            color: gradient(colorWithAlpha(t.bad, 0.95), colorWithAlpha(t.bad, 0.4)) },
        ],
      })}
    />
  );
}

// ─── 6. Cache savings — solid gauge ───────────────────────────────────────
export function CacheGauge({ metrics }) {
  const value = Math.round(metrics.cacheSavingsPct || 0);
  return (
    <Chart
      height={260}
      deps={[value]}
      build={(t, base) => ({
        ...base,
        chart: { ...base.chart, type: "solidgauge", height: 260, marginTop: 10 },
        pane: {
          startAngle: -120, endAngle: 120,
          background: [{ outerRadius: "100%", innerRadius: "78%",
            backgroundColor: t.hair, borderWidth: 0, shape: "arc" }],
        },
        tooltip: { enabled: false },
        yAxis: { min: 0, max: 100, lineWidth: 0, tickInterval: 25,
          minorTickInterval: null, tickLength: 0,
          labels: { distance: 18,
            style: { color: t.muted, fontFamily: '"JetBrains Mono"', fontSize: "10px" } } },
        plotOptions: { solidgauge: {
          dataLabels: { enabled: true, y: 28, borderWidth: 0, useHTML: true,
            format:
              `<div style="text-align:center;">` +
              `<div style="font-family:'Geist';font-size:48px;font-weight:500;` +
              `letter-spacing:-0.02em;color:${t.ink};">{y}` +
              `<span style="font-size:24px;color:${t.muted};">%</span></div>` +
              `<div style="font-family:'JetBrains Mono';font-size:10.5px;letter-spacing:.08em;` +
              `text-transform:uppercase;color:${t.muted};margin-top:4px;">cache hit rate</div>` +
              `</div>` },
          rounded: true, linecap: "round" } },
        series: [{ name: "Cache",
          data: [{ y: value,
            color: gradientH(colorWithAlpha(t.val, 0.65), colorWithAlpha(t.val, 1.0)),
            radius: "100%", innerRadius: "78%" }] }],
      })}
    />
  );
}

// ─── 7. Peak vs off-peak ──────────────────────────────────────────────────
export function PeakOffPeakChart({ metrics }) {
  const p = metrics.peakOffPeak;
  return (
    <Chart
      height={260}
      deps={[p.peak, p.offpeak]}
      build={(t, base) => ({
        ...base,
        chart: { ...base.chart, type: "column", height: 260 },
        xAxis: { ...base.xAxis, categories: ["Peak hours", "Off-peak"],
          lineColor: t.hair,
          labels: { style: { color: t.ink2, fontFamily: '"Geist", sans-serif', fontSize: "13px" } } },
        yAxis: { ...base.yAxis,
          title: { text: "Q5h / turn",
                   style: { color: t.muted, fontFamily: '"JetBrains Mono"', fontSize: "10.5px",
                            letterSpacing: ".06em", textTransform: "uppercase" } },
          min: 0, max: Math.max(p.peak, p.offpeak) * 1.3 || 0.005,
          labels: { ...base.yAxis.labels,
            formatter: function () { return this.value.toFixed(4); } } },
        legend: { enabled: false },
        tooltip: { ...base.tooltip,
          pointFormatter: function () {
            return `<b style="font-family:'JetBrains Mono';">${this.y.toFixed(4)}</b> Q5h / turn`;
          } },
        plotOptions: { ...base.plotOptions,
          column: { ...base.plotOptions.column,
            dataLabels: { enabled: true,
              formatter: function () { return this.y.toFixed(4); }, y: -4,
              style: { color: t.ink, fontFamily: '"JetBrains Mono"', fontSize: "11.5px",
                       textOutline: "none" } },
            pointPadding: 0.18, groupPadding: 0.3 } },
        series: [{ name: "Q5h",
          data: [
            { y: p.peak,    color: gradient(colorWithAlpha(t.bad, 0.95), colorWithAlpha(t.bad, 0.4)) },
            { y: p.offpeak, color: gradient(colorWithAlpha(t.val, 0.95), colorWithAlpha(t.val, 0.4)) },
          ] }],
      })}
    />
  );
}

// ─── 8. Savings waterfall ─────────────────────────────────────────────────
export function SavingsWaterfall({ metrics }) {
  const noCache = Math.round(metrics.noCacheCost);
  const savings = -Math.round(metrics.noCacheCost - metrics.totalApiCost);
  const planPaid = -Math.round(metrics.subscriptionCostPaid);

  return (
    <Chart
      height={300}
      deps={[noCache, savings, planPaid]}
      build={(t, base) => ({
        ...base,
        chart: { ...base.chart, type: "waterfall", height: 300 },
        xAxis: { ...base.xAxis,
          categories: ["Full API cost", "Cache savings", "Net API value", "Plan paid", "Realised value"],
          lineColor: t.hair,
          labels: { style: { color: t.ink2, fontFamily: '"Geist", sans-serif', fontSize: "12px" } } },
        yAxis: { ...base.yAxis,
          title: { text: "USD",
                   style: { color: t.muted, fontFamily: '"JetBrains Mono"', fontSize: "10.5px",
                            letterSpacing: ".06em", textTransform: "uppercase" } },
          labels: { ...base.yAxis.labels,
            formatter: function () { return "$" + (this.value / 1000).toFixed(0) + "k"; } } },
        legend: { enabled: false },
        tooltip: { ...base.tooltip,
          pointFormatter: function () {
            const v = this.y;
            return `<b style="font-family:'JetBrains Mono';">${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString()}</b>`;
          } },
        plotOptions: { ...base.plotOptions,
          series: { ...base.plotOptions.series,
            dataLabels: { enabled: true,
              formatter: function () {
                const v = this.y;
                if (this.point.isSum || this.point.isIntermediateSum) {
                  const total = this.point.total ?? this.y ?? 0;
                  return "$" + Math.abs(total).toLocaleString();
                }
                return (v < 0 ? "-$" : "+$") + Math.abs(v ?? 0).toLocaleString();
              },
              style: { color: t.ink, fontFamily: '"JetBrains Mono"', fontSize: "11.5px",
                       fontWeight: "500", textOutline: "none" }, y: -4 } } },
        series: [{
          upColor: gradient(colorWithAlpha(t.bad, 0.95), colorWithAlpha(t.bad, 0.4)),
          color:   gradient(colorWithAlpha(t.val, 0.95), colorWithAlpha(t.val, 0.4)),
          name: "Cost flow",
          data: [
            { name: "Full API cost", y: noCache,
              color: gradient(colorWithAlpha(t.bad, 0.95), colorWithAlpha(t.bad, 0.4)) },
            { name: "Cache savings", y: savings,
              color: gradient(colorWithAlpha(t.val, 0.95), colorWithAlpha(t.val, 0.4)) },
            { name: "Net API value", isIntermediateSum: true,
              color: gradient(colorWithAlpha(t.info, 0.95), colorWithAlpha(t.info, 0.4)) },
            { name: "Plan paid", y: planPaid,
              color: gradient(colorWithAlpha(t.accent, 0.95), colorWithAlpha(t.accent, 0.4)) },
            { name: "Realised value", isSum: true,
              color: gradient(colorWithAlpha(t.val, 1.0), colorWithAlpha(t.val, 0.5)) },
          ],
          pointPadding: 0,
        }],
      })}
    />
  );
}
