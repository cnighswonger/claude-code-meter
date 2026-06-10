// web/src/components/charts.jsx
//
// All ECharts chart components. Each takes the derived `metrics` object (or
// a subset of it) and produces a single chart inside the shared <Chart>
// wrapper.
//
// The single point where the charting library is touched directly is
// lib/chartBase.jsx — this file builds ECharts option objects only.

import React from "react";
import { Chart, gradient, gradientH, colorWithAlpha } from "../lib/chartBase.jsx";
import { getModelMetric, shortenModel } from "../lib/model-metrics.mjs";
import { MODEL_DISPLAY_ORDER, MODEL_BASELINE } from "../../../src/rates.mjs";

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
        const maxY = Math.max(...data.map((d) => d.y)) * 1.08;
        return {
          ...base,
          grid: { ...base.grid, left: 4, right: 70, top: 10, bottom: 14, containLabel: true },
          // Horizontal bar: value axis on X, category axis on Y (reversed so the
          // first item in `data` appears on top — matches the original layout).
          xAxis: {
            ...base.xAxis,
            type: "value",
            min: 0,
            max: maxY,
            interval: 10000,
            axisLabel: { ...base.xAxis.axisLabel,
              formatter: (v) => "$" + (v / 1000) + "k" },
            name: "USD",
            nameLocation: "middle",
            nameGap: 28,
            splitLine: { show: true, lineStyle: { color: t.hair, type: "dashed" } },
          },
          yAxis: {
            ...base.yAxis,
            type: "category",
            data: [...data].reverse().map((d) => d.name),
            inverse: false,
            axisLine: { show: false },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { ...base.yAxis.axisLabel,
              color: t.ink2, fontFamily: '"Geist", sans-serif', fontSize: 13 },
          },
          tooltip: { ...base.tooltip, trigger: "item",
            formatter: (p) => `<b style="font-family:${base._fonts.fMono};">$${Number(p.value).toLocaleString(undefined, { maximumFractionDigits: 0 })}</b>`,
          },
          legend: { ...base.legend, show: false },
          series: [{
            name: "USD",
            type: "bar",
            barCategoryGap: "8%",
            itemStyle: { borderRadius: [0, 4, 4, 0] },
            label: {
              show: true,
              position: "right",
              distance: 8,
              color: t.ink,
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 12,
              formatter: (p) => "$" + Number(p.value).toLocaleString(undefined, { maximumFractionDigits: 0 }),
            },
            data: [...data].reverse().map((d) => ({
              value: d.y,
              itemStyle: { color: colorFor(d.kind), borderRadius: [0, 4, 4, 0] },
            })),
          }],
        };
      }}
    />
  );
}

// ─── 2. L(t) multiplier — bar ─────────────────────────────────────────────
export function MultiplierChart({ metrics }) {
  const m = metrics.planMultipliers;
  const categories = ["Pro ($20)", "Max 5x ($100)", "Max 20x ($200)"];
  const values = [m.pro, m.max_5x, m.max_20x];
  return (
    <Chart
      height={260}
      deps={[m.pro, m.max_5x, m.max_20x]}
      build={(t, base) => ({
        ...base,
        grid: { ...base.grid, left: 4, right: 80, top: 10, bottom: 14, containLabel: true },
        xAxis: {
          ...base.xAxis,
          type: "value",
          min: 0,
          max: Math.max(...values) * 1.12,
          splitLine: { show: true, lineStyle: { color: t.hair, type: "dashed" } },
          name: "L(t) — subscription-leverage multiplier (API$ ÷ subscription$)",
          nameLocation: "middle",
          nameGap: 28,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace',
            fontSize: 10.5, lineHeight: 14 },
          axisLabel: { ...base.xAxis.axisLabel, formatter: (v) => v.toFixed(1) + "×" },
        },
        yAxis: {
          ...base.yAxis,
          type: "category",
          data: [...categories].reverse(),
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { ...base.yAxis.axisLabel,
            color: t.ink2, fontFamily: '"Geist", sans-serif', fontSize: 13 },
        },
        tooltip: { ...base.tooltip, trigger: "item",
          formatter: (p) => `<b style="font-family:${base._fonts.fMono};">${Number(p.value).toFixed(1)}×</b> value`,
        },
        legend: { ...base.legend, show: false },
        series: [{
          name: "Multiplier",
          type: "bar",
          barCategoryGap: "30%",
          markLine: {
            symbol: "none",
            silent: true,
            lineStyle: { color: t.hairStr, type: "dashed", width: 1 },
            label: {
              formatter: "Pro / Max 5x baseline",
              color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
              position: "insideEndTop",
            },
            data: [{ xAxis: m.max_5x }],
          },
          label: {
            show: true, position: "right", distance: 4,
            color: t.ink, fontFamily: '"Geist", sans-serif', fontSize: 16, fontWeight: 500,
            formatter: (p) => Number(p.value).toFixed(1) + "×",
          },
          data: [
            { value: m.max_20x, itemStyle: { color: gradientH(colorWithAlpha(t.accent, 0.95), colorWithAlpha(t.accent, 0.55)), borderRadius: [0, 4, 4, 0] } },
            { value: m.max_5x,  itemStyle: { color: gradientH(colorWithAlpha(t.info, 0.85),  colorWithAlpha(t.info, 0.5)),  borderRadius: [0, 4, 4, 0] } },
            { value: m.pro,     itemStyle: { color: gradientH(colorWithAlpha(t.info, 0.85),  colorWithAlpha(t.info, 0.5)),  borderRadius: [0, 4, 4, 0] } },
          ],
        }],
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
        grid: { ...base.grid, left: 4, right: 80, top: 10, bottom: 14, containLabel: true },
        xAxis: {
          ...base.xAxis,
          type: "value",
          min: -span, max: span,
          name: "Q5h cost per token (×10⁻⁷)",
          nameLocation: "middle",
          nameGap: 28,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
          splitLine: { show: true, lineStyle: { color: t.hair, type: "dashed" } },
        },
        yAxis: {
          ...base.yAxis,
          type: "category",
          data: [...data].reverse().map((d) => d.name),
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { ...base.yAxis.axisLabel,
            color: t.ink2, fontFamily: '"JetBrains Mono", monospace', fontSize: 12.5 },
        },
        tooltip: { ...base.tooltip, trigger: "item",
          formatter: (p) => `<b style="font-family:${base._fonts.fMono};">${p.value > 0 ? "+" : ""}${Number(p.value).toFixed(3)}e-7</b> Q5h / token`,
        },
        legend: { ...base.legend, show: false },
        series: [{
          name: "Coefficient",
          type: "bar",
          barCategoryGap: "20%",
          markLine: {
            symbol: "none", silent: true,
            lineStyle: { color: t.hairStr, width: 1 },
            data: [{ xAxis: 0 }],
            label: { show: false },
          },
          label: {
            show: true,
            position: (params) => (params.value >= 0 ? "right" : "left"),
            distance: 4,
            color: t.ink2, fontFamily: '"JetBrains Mono", monospace', fontSize: 11, fontWeight: 500,
            formatter: (p) => (p.value > 0 ? "+" : "") + Number(p.value).toFixed(2) + "e-7",
          },
          data: [...data].reverse().map((d) => ({
            value: d.y,
            itemStyle: {
              color:
                d.kind === "warn" ? gradientH(colorWithAlpha(t.warn, 0.55), colorWithAlpha(t.warn, 0.95)) :
                d.kind === "val"  ? gradientH(colorWithAlpha(t.val,  0.55), colorWithAlpha(t.val,  0.95)) :
                d.kind === "info" ? gradientH(colorWithAlpha(t.info, 0.95), colorWithAlpha(t.info, 0.55)) :
                                    gradientH(colorWithAlpha(t.bad,  0.95), colorWithAlpha(t.bad,  0.55)),
              borderRadius: [0, 4, 4, 0],
            },
          })),
        }],
      })}
    />
  );
}

// ─── 4. Per-model cost — column ───────────────────────────────────────────
export function ModelCostChart({ metrics }) {
  // Order: cheap → expensive, sourced from MODEL_DISPLAY_ORDER (src/rates.mjs).
  // Adding a new model to that constant automatically renders it here.
  // The 4-color sequence matches the project's existing theme tokens. For
  // MODEL_DISPLAY_ORDER entries beyond index 3, the color recycles by modulus
  // (i % colors.length) — sharing tokens with earlier entries. When the chart
  // needs distinct colors for 5+ models, add a 5th theme token AND a
  // corresponding ternary branch in the color resolver below (~line 308).
  const colors = ["val", "info", "warn", "bad"];
  const data = MODEL_DISPLAY_ORDER
    .map((m, i) => ({
      name: shortenModel(m),
      y: getModelMetric(metrics, m, "modelCostPerTurn"),
      kind: colors[i % colors.length],
    }))
    .filter((d) => d.y > 0);
  const baseline = getModelMetric(metrics, MODEL_BASELINE, "modelCostPerTurn");
  // NOTE: If `baseline === 0`, MODEL_BASELINE has zero observed cost-per-turn
  // in this dataset (the model sunset, or no one in the community has
  // submitted using it this window). The renderer below suppresses the
  // "% vs baseline" annotation and shows "baseline N/A" instead of silently
  // picking a replacement model.
  const baselineLabel = shortenModel(MODEL_BASELINE);

  return (
    <Chart
      height={320}
      deps={[JSON.stringify(metrics.modelCostPerTurn)]}
      build={(t, base) => ({
        ...base,
        grid: { ...base.grid, left: 4, right: 4, top: 30, bottom: 14, containLabel: true },
        xAxis: {
          ...base.xAxis,
          type: "category",
          data: data.map((d) => d.name),
          axisLine: { lineStyle: { color: t.hair } },
          axisTick: { show: false },
          axisLabel: { ...base.xAxis.axisLabel,
            color: t.ink2, fontFamily: '"JetBrains Mono", monospace', fontSize: 12 },
        },
        yAxis: {
          ...base.yAxis,
          type: "value",
          min: 0,
          name: "USD / turn",
          nameLocation: "middle",
          nameGap: 50,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
          axisLabel: { ...base.yAxis.axisLabel, formatter: (v) => "$" + v.toFixed(2) },
        },
        tooltip: { ...base.tooltip, trigger: "item",
          formatter: (p) => {
            if (baseline <= 0) {
              return `<b style="font-family:${base._fonts.fMono};">$${Number(p.value).toFixed(4)}</b> / turn<br/>` +
                     `<span style="color:${t.muted};font-size:11px;">baseline N/A</span>`;
            }
            const vsBase = ((p.value / baseline - 1) * 100).toFixed(0);
            const sign = Number(vsBase) >= 0 ? "+" : "";
            return `<b style="font-family:${base._fonts.fMono};">$${Number(p.value).toFixed(4)}</b> / turn<br/>` +
                   `<span style="color:${t.muted};font-size:11px;">${sign}${vsBase}% vs ${baselineLabel}</span>`;
          },
        },
        legend: { ...base.legend, show: false },
        series: [{
          name: "Cost",
          type: "bar",
          barCategoryGap: "30%",
          markLine: baseline > 0 ? {
            symbol: "none", silent: true,
            lineStyle: { color: t.hairStr, type: "dashed", width: 1 },
            label: {
              formatter: `${baselineLabel} baseline`,
              color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
              position: "insideStartTop",
            },
            data: [{ yAxis: baseline }],
          } : undefined,
          label: {
            show: true, position: "top", distance: 4,
            color: t.ink, fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, fontWeight: 500,
            formatter: (p) => "$" + Number(p.value).toFixed(4),
          },
          data: data.map((d) => ({
            value: d.y,
            itemStyle: {
              color:
                d.kind === "val"  ? gradient(colorWithAlpha(t.val,  0.95), colorWithAlpha(t.val,  0.4)) :
                d.kind === "info" ? gradient(colorWithAlpha(t.info, 0.95), colorWithAlpha(t.info, 0.4)) :
                d.kind === "warn" ? gradient(colorWithAlpha(t.warn, 0.95), colorWithAlpha(t.warn, 0.4)) :
                                    gradient(colorWithAlpha(t.bad,  0.95), colorWithAlpha(t.bad,  0.4)),
              borderRadius: [4, 4, 0, 0],
            },
          })),
        }],
      })}
    />
  );
}

// ─── 5. Opus 4.7 paired column ────────────────────────────────────────────
export function Opus47Chart({ metrics }) {
  const a = metrics.advisory;
  const categories = ["Q5h burn", "API $ / turn", "Tool-call cost"];
  return (
    <Chart
      height={240}
      deps={[a.burnMultiplier, a.apiCostMultiplier, a.toolCallMultiplier]}
      build={(t, base) => ({
        ...base,
        grid: { ...base.grid, left: 4, right: 4, top: 36, bottom: 14, containLabel: true },
        xAxis: {
          ...base.xAxis,
          type: "category",
          data: categories,
          axisLine: { lineStyle: { color: t.hair } },
          axisTick: { show: false },
          axisLabel: { ...base.xAxis.axisLabel,
            color: t.ink2, fontFamily: '"Geist", sans-serif', fontSize: 12 },
        },
        yAxis: {
          ...base.yAxis,
          type: "value",
          min: 0,
          max: Math.max(a.burnMultiplier, a.apiCostMultiplier, a.toolCallMultiplier) * 1.15,
          name: "Relative to Opus 4.6 (= 1.0×)",
          nameLocation: "middle",
          nameGap: 36,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
          axisLabel: { ...base.yAxis.axisLabel, formatter: (v) => v.toFixed(1) + "×" },
        },
        tooltip: { ...base.tooltip, trigger: "axis",
          axisPointer: { type: "shadow", shadowStyle: { color: t.hair } },
        },
        legend: { ...base.legend, show: true,
          left: "left", top: 0,
          textStyle: { ...base.legend.textStyle, color: t.ink2 },
          data: ["opus-4-6", "opus-4-7"],
        },
        series: [
          {
            name: "opus-4-6",
            type: "bar",
            barCategoryGap: "30%",
            itemStyle: {
              color: gradient(colorWithAlpha(t.info, 0.85), colorWithAlpha(t.info, 0.4)),
              borderRadius: [4, 4, 0, 0],
            },
            label: {
              show: true, position: "top", distance: 4,
              color: t.ink, fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, fontWeight: 500,
              formatter: (p) => Number(p.value).toFixed(1) + "×",
            },
            data: [1.0, 1.0, 1.0],
            markLine: {
              symbol: "none", silent: true,
              lineStyle: { color: t.hairStr, type: "dashed", width: 1 },
              data: [{ yAxis: 1.0 }],
            },
          },
          {
            name: "opus-4-7",
            type: "bar",
            barCategoryGap: "30%",
            itemStyle: {
              color: gradient(colorWithAlpha(t.bad, 0.95), colorWithAlpha(t.bad, 0.4)),
              borderRadius: [4, 4, 0, 0],
            },
            label: {
              show: true, position: "top", distance: 4,
              color: t.ink, fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, fontWeight: 500,
              formatter: (p) => Number(p.value).toFixed(1) + "×",
            },
            data: [a.burnMultiplier, a.apiCostMultiplier, a.toolCallMultiplier],
          },
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
        tooltip: { show: false },
        series: [{
          name: "Cache",
          type: "gauge",
          // -120° to +120° matches the prior Highcharts pane angles.
          startAngle: 210,
          endAngle: -30,
          min: 0, max: 100,
          radius: "92%",
          progress: {
            show: true,
            width: 22,
            roundCap: true,
            itemStyle: {
              color: gradientH(colorWithAlpha(t.val, 0.65), colorWithAlpha(t.val, 1.0)),
            },
          },
          axisLine: {
            lineStyle: { width: 22, color: [[1, t.hair]] },
            roundCap: true,
          },
          pointer: { show: false },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: {
            distance: -34,
            color: t.muted,
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 10,
            formatter: (v) => (v % 25 === 0 ? String(v) : ""),
          },
          title: { show: false },
          detail: {
            valueAnimation: true,
            offsetCenter: [0, "12%"],
            formatter: (v) => {
              const n = Math.round(v);
              return `{val|${n}}{pct|%}\n{label|cache hit rate}`;
            },
            rich: {
              val:   { fontFamily: '"Geist", sans-serif', fontSize: 48, fontWeight: 500,
                       color: t.ink, lineHeight: 52 },
              pct:   { fontFamily: '"Geist", sans-serif', fontSize: 24, color: t.muted },
              label: { fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5,
                       color: t.muted, padding: [6, 0, 0, 0],
                       letterSpacing: 1 },
            },
          },
          data: [{ value, name: "" }],
        }],
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
        grid: { ...base.grid, left: 4, right: 4, top: 10, bottom: 14, containLabel: true },
        xAxis: {
          ...base.xAxis,
          type: "category",
          data: ["Peak hours", "Off-peak"],
          axisLine: { lineStyle: { color: t.hair } },
          axisTick: { show: false },
          axisLabel: { ...base.xAxis.axisLabel,
            color: t.ink2, fontFamily: '"Geist", sans-serif', fontSize: 13 },
        },
        yAxis: {
          ...base.yAxis,
          type: "value",
          min: 0,
          max: Math.max(p.peak, p.offpeak) * 1.3 || 0.005,
          name: "Q5h / turn",
          nameLocation: "middle",
          nameGap: 50,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
          axisLabel: { ...base.yAxis.axisLabel, formatter: (v) => Number(v).toFixed(4) },
        },
        tooltip: { ...base.tooltip, trigger: "item",
          formatter: (p2) => `<b style="font-family:${base._fonts.fMono};">${Number(p2.value).toFixed(4)}</b> Q5h / turn`,
        },
        legend: { ...base.legend, show: false },
        series: [{
          name: "Q5h",
          type: "bar",
          barCategoryGap: "40%",
          label: {
            show: true, position: "top", distance: 4,
            color: t.ink, fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5,
            formatter: (p2) => Number(p2.value).toFixed(4),
          },
          data: [
            { value: p.peak,    itemStyle: { color: gradient(colorWithAlpha(t.bad, 0.95), colorWithAlpha(t.bad, 0.4)), borderRadius: [4, 4, 0, 0] } },
            { value: p.offpeak, itemStyle: { color: gradient(colorWithAlpha(t.val, 0.95), colorWithAlpha(t.val, 0.4)), borderRadius: [4, 4, 0, 0] } },
          ],
        }],
      })}
    />
  );
}

// ─── 8. Savings waterfall ─────────────────────────────────────────────────
// ECharts has no native waterfall series. We render the same shape as the
// prior Highcharts waterfall using the documented stacked-bar pattern:
//   - placeholder (transparent) series carries the cumulative offset
//   - one visible bar per step stacks on top of the placeholder
// Intermediate-sum and final-sum steps draw a single bar from zero up to
// the running total, matching Highcharts' isIntermediateSum / isSum semantics.
//   Reference: https://echarts.apache.org/handbook/en/how-to/chart-types/bar/waterfall/
export function SavingsWaterfall({ metrics }) {
  const noCache = Math.round(metrics.noCacheCost);
  const savings = -Math.round(metrics.noCacheCost - metrics.totalApiCost);
  const planPaid = -Math.round(metrics.subscriptionCostPaid);

  // Build steps in the same order/labels as before. `kind` controls coloring.
  const steps = [
    { name: "Full API cost", value: noCache,  kind: "bad",    sum: false },
    { name: "Cache savings", value: savings,  kind: "val",    sum: false },
    { name: "Net API value", value: 0,        kind: "info",   sum: "intermediate" },
    { name: "Plan paid",     value: planPaid, kind: "accent", sum: false },
    { name: "Realised value",value: 0,        kind: "val2",   sum: "final" },
  ];

  // Walk steps to compute placeholder offsets and visible bar magnitudes.
  let running = 0;
  const computed = steps.map((s) => {
    if (s.sum === "intermediate" || s.sum === "final") {
      // Sum bar draws from zero to current running total.
      const total = running;
      return { ...s, placeholder: 0, visible: total, isPositive: total >= 0, total };
    }
    const next = running + s.value;
    // Place the bar between min(running,next) and max(running,next).
    const placeholder = Math.min(running, next);
    const visible = Math.abs(s.value);
    const isPositive = s.value >= 0;
    running = next;
    return { ...s, placeholder, visible, isPositive, total: next };
  });

  return (
    <Chart
      height={300}
      deps={[noCache, savings, planPaid]}
      build={(t, base) => {
        const colorFor = (kind) =>
          kind === "bad"    ? gradient(colorWithAlpha(t.bad,    0.95), colorWithAlpha(t.bad,    0.4)) :
          kind === "val"    ? gradient(colorWithAlpha(t.val,    0.95), colorWithAlpha(t.val,    0.4)) :
          kind === "val2"   ? gradient(colorWithAlpha(t.val,    1.0),  colorWithAlpha(t.val,    0.5)) :
          kind === "info"   ? gradient(colorWithAlpha(t.info,   0.95), colorWithAlpha(t.info,   0.4)) :
                              gradient(colorWithAlpha(t.accent, 0.95), colorWithAlpha(t.accent, 0.4));

        return {
          ...base,
          grid: { ...base.grid, left: 4, right: 4, top: 30, bottom: 14, containLabel: true },
          xAxis: {
            ...base.xAxis,
            type: "category",
            data: computed.map((s) => s.name),
            axisLine: { lineStyle: { color: t.hair } },
            axisTick: { show: false },
            axisLabel: { ...base.xAxis.axisLabel,
              color: t.ink2, fontFamily: '"Geist", sans-serif', fontSize: 12 },
          },
          yAxis: {
            ...base.yAxis,
            type: "value",
            name: "USD",
            nameLocation: "middle",
            nameGap: 50,
            nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
            axisLabel: { ...base.yAxis.axisLabel,
              formatter: (v) => "$" + (v / 1000).toFixed(0) + "k" },
          },
          tooltip: { ...base.tooltip, trigger: "axis",
            axisPointer: { type: "shadow", shadowStyle: { color: t.hair } },
            formatter: (params) => {
              // Only show the visible series row, not the transparent placeholder.
              const idx = params[0]?.dataIndex;
              if (idx == null) return "";
              const s = computed[idx];
              if (s.sum) {
                const sign = s.total < 0 ? "-" : "";
                return `${s.name}<br/><b style="font-family:${base._fonts.fMono};">${sign}$${Math.abs(s.total).toLocaleString()}</b>`;
              }
              return `${s.name}<br/><b style="font-family:${base._fonts.fMono};">${s.value < 0 ? "-" : ""}$${Math.abs(s.value).toLocaleString()}</b>`;
            },
          },
          legend: { ...base.legend, show: false },
          series: [
            // Placeholder: transparent bar that carries the cumulative offset.
            {
              name: "_placeholder",
              type: "bar",
              stack: "wf",
              itemStyle: { color: "rgba(0,0,0,0)", borderColor: "transparent" },
              emphasis: { itemStyle: { color: "rgba(0,0,0,0)" } },
              data: computed.map((s) => s.placeholder),
              silent: true,
              tooltip: { show: false },
            },
            // Visible: per-step bar with kind-specific gradient.
            {
              name: "Cost flow",
              type: "bar",
              stack: "wf",
              barCategoryGap: "20%",
              label: {
                show: true, position: "top", distance: 4,
                color: t.ink, fontFamily: '"JetBrains Mono", monospace', fontSize: 11.5, fontWeight: 500,
                formatter: (p) => {
                  const s = computed[p.dataIndex];
                  if (s.sum) {
                    const sign = s.total < 0 ? "-" : "";
                    return sign + "$" + Math.abs(s.total).toLocaleString();
                  }
                  return (s.value < 0 ? "-$" : "+$") + Math.abs(s.value).toLocaleString();
                },
              },
              data: computed.map((s) => ({
                value: s.visible,
                itemStyle: { color: colorFor(s.kind), borderRadius: [4, 4, 0, 0] },
              })),
            },
          ],
        };
      }}
    />
  );
}
