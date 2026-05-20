// web/src/components/analysis-charts.jsx
// Additional Apache ECharts components for the Deep Analysis page.
// Built on the same chartBase.jsx as the dashboard's charts.jsx.

import React from "react";
import { Chart, gradient, gradientH, colorWithAlpha } from "../lib/chartBase.jsx";

// ─── Q7d capacity by cache scenario — clustered column ───────────────────
export function CapacityScenarioChart({ scenarios }) {
  const categories = ["Pro · $20", "Max 5x · $100", "Max 20x · $200"];
  return (
    <Chart
      height={340}
      deps={[JSON.stringify(scenarios)]}
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
            color: t.ink2, fontFamily: '"Geist", sans-serif', fontSize: 13 },
        },
        yAxis: {
          ...base.yAxis,
          type: "value",
          name: "Estimated tokens per week (billions)",
          nameLocation: "middle",
          nameGap: 50,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
          axisLabel: { ...base.yAxis.axisLabel, formatter: (v) => v + "B" },
        },
        tooltip: { ...base.tooltip, trigger: "axis",
          axisPointer: { type: "shadow", shadowStyle: { color: t.hair } },
          formatter: (params) => {
            const cat = params[0]?.axisValueLabel ?? "";
            const rows = params.map((p) => {
              const c = (p.color && p.color.colorStops?.[0]?.color) || p.color || "#fff";
              return `<span style="color:${c};">●</span> <b>${p.seriesName}</b>: <span style="font-family:${base._fonts.fMono};">${Number(p.value).toFixed(1)}B</span>`;
            }).join("<br/>");
            return `${cat}<br/>${rows}`;
          },
        },
        legend: { ...base.legend, show: true,
          left: "left", top: 0,
          textStyle: { ...base.legend.textStyle, color: t.ink2 },
          data: scenarios.map((s) => s.name),
        },
        series: scenarios.map((s) => ({
          name: s.name,
          type: "bar",
          barCategoryGap: "30%",
          itemStyle: {
            color:
              s.kind === "val"  ? gradient(colorWithAlpha(t.val,  0.95), colorWithAlpha(t.val,  0.4)) :
              s.kind === "info" ? gradient(colorWithAlpha(t.info, 0.95), colorWithAlpha(t.info, 0.4)) :
                                  gradient(colorWithAlpha(t.bad,  0.95), colorWithAlpha(t.bad,  0.4)),
            borderRadius: [4, 4, 0, 0],
          },
          label: {
            show: true, position: "top", distance: 4,
            color: t.ink, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, fontWeight: 500,
            formatter: (p) => Number(p.value).toFixed(1) + "B",
          },
          data: s.data,
        })),
      })}
    />
  );
}

// ─── Cache-rate sensitivity — area chart ─────────────────────────────────
export function CacheSensitivityChart() {
  const points = [];
  for (let h = 0; h <= 100; h += 5) {
    const cache_read = h * 0.988 / 100;
    const cache_create = 0.01;
    const input = (1 - cache_read - cache_create - 0.002);
    const output = 0.002;
    const weighted = output * 25 + input * 5 + cache_create * 10 + cache_read * 0.50;
    points.push([h, weighted]);
  }
  return (
    <Chart
      height={300}
      deps={[]}
      build={(t, base) => ({
        ...base,
        grid: { ...base.grid, left: 4, right: 4, top: 16, bottom: 14, containLabel: true },
        xAxis: {
          ...base.xAxis,
          type: "value",
          name: "Cache hit rate",
          nameLocation: "middle",
          nameGap: 28,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
          min: 0, max: 100,
          interval: 10,
          axisLabel: { ...base.xAxis.axisLabel, formatter: (v) => v + "%" },
        },
        yAxis: {
          ...base.yAxis,
          type: "value",
          name: "$/MTok blended cost",
          nameLocation: "middle",
          nameGap: 50,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
          axisLabel: { ...base.yAxis.axisLabel, formatter: (v) => "$" + Number(v).toFixed(2) },
        },
        tooltip: { ...base.tooltip, trigger: "axis",
          axisPointer: { type: "line", lineStyle: { color: t.hairStr, type: "dashed" } },
          formatter: (params) => {
            const p = params[0];
            const [x, y] = p.value;
            return `<b style="font-family:${base._fonts.fMono};">$${Number(y).toFixed(3)}</b>/MTok at <b>${x}%</b> cache`;
          },
        },
        legend: { ...base.legend, show: false },
        series: [{
          name: "Cost",
          type: "line",
          smooth: false,
          showSymbol: false,
          lineStyle: { color: t.info, width: 2 },
          itemStyle: { color: t.info },
          areaStyle: { color: gradient(colorWithAlpha(t.info, 0.4), colorWithAlpha(t.info, 0)) },
          data: points,
          markLine: {
            symbol: "none", silent: true,
            lineStyle: { color: t.warn, type: "dashed", width: 1 },
            label: {
              formatter: "Observed (88%)",
              color: t.warn, fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
              position: "insideEndTop",
            },
            data: [{ xAxis: 88 }],
          },
        }],
      })}
    />
  );
}

// ─── Quota windows — horizontal bar ───────────────────────────────────────
export function QuotaWindowsChart() {
  const categories = ["Q5h window", "Q7d window"];
  return (
    <Chart
      height={170}
      deps={[]}
      build={(t, base) => ({
        ...base,
        grid: { ...base.grid, left: 4, right: 60, top: 10, bottom: 14, containLabel: true },
        xAxis: {
          ...base.xAxis,
          type: "value",
          min: 0, max: 180,
          name: "Hours per reset",
          nameLocation: "middle",
          nameGap: 28,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
          splitLine: { show: true, lineStyle: { color: t.hair, type: "dashed" } },
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
          formatter: (p) => `<b style="font-family:${base._fonts.fMono};">${Number(p.value)}</b> hours per reset`,
        },
        legend: { ...base.legend, show: false },
        series: [{
          name: "Hours",
          type: "bar",
          barCategoryGap: "40%",
          label: {
            show: true, position: "right", distance: 4,
            color: t.ink, fontFamily: '"JetBrains Mono", monospace', fontSize: 12, fontWeight: 500,
            formatter: (p) => Number(p.value) + "h",
          },
          markLine: {
            symbol: "none", silent: true,
            lineStyle: { color: t.hair, type: "dotted", width: 1 },
            label: {
              color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
              position: "insideEndTop",
            },
            data: [
              { xAxis: 24,  label: { formatter: "1d" } },
              { xAxis: 168, label: { formatter: "1w" } },
            ],
          },
          data: [
            // Reversed to match the yAxis (Q7d at top, Q5h at bottom by default)
            { value: 168, itemStyle: { color: gradientH(colorWithAlpha(t.warn, 0.95), colorWithAlpha(t.warn, 0.45)), borderRadius: [0, 4, 4, 0] } },
            { value: 5,   itemStyle: { color: gradientH(colorWithAlpha(t.info, 0.95), colorWithAlpha(t.info, 0.45)), borderRadius: [0, 4, 4, 0] } },
          ],
        }],
      })}
    />
  );
}

// ─── Model substitution savings — column ─────────────────────────────────
export function SubstitutionChart({ modelCostPerTurn }) {
  const opus47 = modelCostPerTurn["claude-opus-4-7"] || 0;
  const haiku  = modelCostPerTurn["claude-haiku-4-5"] || 0;
  if (opus47 === 0 || haiku === 0) return null;

  const data = [
    { pct: 0,   label: "All Opus 4.7" },
    { pct: 25,  label: "25% Haiku" },
    { pct: 50,  label: "50% Haiku" },
    { pct: 75,  label: "75% Haiku" },
    { pct: 100, label: "All Haiku 4.5" },
  ].map((d) => ({
    name: d.label,
    y: (1 - d.pct / 100) * opus47 + (d.pct / 100) * haiku,
    pct: d.pct,
  }));

  return (
    <Chart
      height={260}
      deps={[opus47, haiku]}
      build={(t, base) => ({
        ...base,
        grid: { ...base.grid, left: 4, right: 4, top: 16, bottom: 14, containLabel: true },
        xAxis: {
          ...base.xAxis,
          type: "category",
          data: data.map((d) => d.name),
          axisLine: { lineStyle: { color: t.hair } },
          axisTick: { show: false },
          axisLabel: { ...base.xAxis.axisLabel,
            color: t.ink2, fontFamily: '"JetBrains Mono", monospace', fontSize: 11 },
        },
        yAxis: {
          ...base.yAxis,
          type: "value",
          min: 0,
          name: "Avg $/turn",
          nameLocation: "middle",
          nameGap: 50,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
          axisLabel: { ...base.yAxis.axisLabel, formatter: (v) => "$" + Number(v).toFixed(3) },
        },
        tooltip: { ...base.tooltip, trigger: "item",
          formatter: (p) => {
            const pct = ((1 - p.value / opus47) * 100).toFixed(0);
            return `<b style="font-family:${base._fonts.fMono};">$${Number(p.value).toFixed(4)}</b>/turn<br/>` +
                   `<span style="color:${t.muted};font-size:11px;">${pct}% cheaper than all-Opus</span>`;
          },
        },
        legend: { ...base.legend, show: false },
        series: [{
          name: "Cost",
          type: "bar",
          barCategoryGap: "30%",
          label: {
            show: true, position: "top", distance: 4,
            color: t.ink, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5, fontWeight: 500,
            formatter: (p) => "$" + Number(p.value).toFixed(3),
          },
          data: data.map((d, i) => ({
            value: d.y,
            itemStyle: {
              color:
                i === 0 ? gradient(colorWithAlpha(t.bad,  0.95), colorWithAlpha(t.bad,  0.4)) :
                i === 4 ? gradient(colorWithAlpha(t.val,  0.95), colorWithAlpha(t.val,  0.4)) :
                          gradient(colorWithAlpha(t.info, 0.85), colorWithAlpha(t.info, 0.4)),
              borderRadius: [4, 4, 0, 0],
            },
          })),
        }],
      })}
    />
  );
}

// ─── Opus 4.7 hypothesis — illustrative ratio under different assumptions ──
export function HypothesisRangeChart({ observedRatio }) {
  const points = [];
  for (let hidden = 0; hidden <= 0.9; hidden += 0.05) {
    const eff = observedRatio / (1 - hidden);
    points.push([Math.round(hidden * 100), Number(eff.toFixed(4))]);
  }
  return (
    <Chart
      height={280}
      deps={[observedRatio]}
      build={(t, base) => ({
        ...base,
        grid: { ...base.grid, left: 4, right: 4, top: 16, bottom: 14, containLabel: true },
        xAxis: {
          ...base.xAxis,
          type: "value",
          name: "Hypothesised hidden-thinking token share",
          nameLocation: "middle",
          nameGap: 28,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
          min: 0, max: 90,
          interval: 10,
          axisLabel: { ...base.xAxis.axisLabel, formatter: (v) => v + "%" },
        },
        yAxis: {
          ...base.yAxis,
          type: "value",
          name: "Effective Q5h cost ratio (4.7 ÷ 4.6)",
          nameLocation: "middle",
          nameGap: 50,
          nameTextStyle: { color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10.5 },
          axisLabel: { ...base.yAxis.axisLabel, formatter: (v) => Number(v).toFixed(1) + "×" },
        },
        tooltip: { ...base.tooltip, trigger: "axis",
          axisPointer: { type: "line", lineStyle: { color: t.hairStr, type: "dashed" } },
          formatter: (params) => {
            const p = params[0];
            const [x, y] = p.value;
            return `If <b style="font-family:${base._fonts.fMono};">${x}%</b> of tokens are hidden,<br/>` +
                   `effective ratio = <b style="font-family:${base._fonts.fMono};">${Number(y).toFixed(2)}×</b>`;
          },
        },
        legend: { ...base.legend, show: false },
        series: [{
          name: "Effective ratio",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { color: t.info, width: 2.5 },
          itemStyle: { color: t.info },
          data: points,
          markLine: {
            symbol: "none", silent: true,
            data: [
              {
                yAxis: 1.0,
                lineStyle: { color: t.hair, type: "dotted", width: 1 },
                label: {
                  formatter: "parity",
                  color: t.muted, fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
                  position: "insideStartTop",
                },
              },
              {
                yAxis: 2.4,
                lineStyle: { color: t.warn, type: "dashed", width: 1 },
                label: {
                  formatter: "hypothesis: ~2.4×",
                  color: t.warn, fontFamily: '"JetBrains Mono", monospace', fontSize: 10,
                  position: "insideStartTop",
                },
              },
            ],
          },
        }],
      })}
    />
  );
}
