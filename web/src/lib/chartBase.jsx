// web/src/lib/chartBase.jsx
//
// Apache ECharts setup, theming, and the shared <Chart> wrapper component.
// Every chart in components/charts.jsx mounts through here.
//
// History: this layer was previously a Highcharts wrapper. Migrated to
// Apache ECharts (Apache-2.0) per LICENSING.md — Highcharts EULA §1.2/§1.4
// excludes commercial-entity-operated public sites from the Personal Use
// scope, and the meter site is operated by a commercial entity.

import React, { useEffect, useRef, useState } from "react";
// Use the /lib/core entry point so the React wrapper doesn't pull in the
// full echarts package — we register only the components we actually use.
import ReactECharts from "echarts-for-react/lib/core";
import * as echarts from "echarts/core";
import { BarChart, GaugeChart } from "echarts/charts";
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  AriaComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

// Register only the components we use. Keeps the bundle below the prior
// Highcharts footprint by tree-shaking everything we don't need.
echarts.use([
  BarChart,
  GaugeChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  AriaComponent,
  CanvasRenderer,
]);

// ─── Theme helpers ─────────────────────────────────────────────────────────

function cssVar(name, fallback = "") {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function colorWithAlpha(hex, alpha) {
  if (!hex || !hex.startsWith("#")) {
    return `color-mix(in oklab, ${hex} ${alpha * 100}%, transparent)`;
  }
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function getTheme() {
  return {
    ink:     cssVar("--ink",     "#e7e9ed"),
    ink2:    cssVar("--ink-2",   "#c0c5cf"),
    muted:   cssVar("--muted",   "#8a919e"),
    hair:    cssVar("--hairline", "rgba(255,255,255,.07)"),
    hairStr: cssVar("--hairline-strong", "rgba(255,255,255,.14)"),
    panel:   cssVar("--panel",   "#141925"),
    bg:      cssVar("--bg",      "#0d1017"),
    accent:  cssVar("--accent",  "#f5b042"),
    val:     cssVar("--val",     "#5ed29b"),
    warn:    cssVar("--warn",    "#f5b042"),
    bad:     cssVar("--bad",     "#ef6b6b"),
    info:    cssVar("--info",    "#7aa7ff"),
  };
}

// baseOptions returns an ECharts option skeleton with theme-aware defaults.
// Each chart in components/charts.jsx spreads this and overrides what it needs.
export function baseOptions(theme) {
  const fMono = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
  const fSans = '"Geist", ui-sans-serif, system-ui, sans-serif';

  return {
    backgroundColor: "transparent",
    color: [theme.info, theme.val, theme.warn, theme.bad, theme.accent, theme.ink2],
    textStyle: { fontFamily: fSans, color: theme.ink },
    animation: true,
    animationDuration: 800,
    grid: { left: 4, right: 4, top: 10, bottom: 14, containLabel: true },
    tooltip: {
      trigger: "item",
      backgroundColor: theme.panel,
      borderColor: theme.hairStr,
      borderWidth: 1,
      borderRadius: 8,
      padding: 10,
      textStyle: { color: theme.ink, fontFamily: fSans, fontSize: 12.5 },
      extraCssText: "box-shadow:none;",
    },
    legend: {
      show: false,
      textStyle: { color: theme.ink2, fontFamily: fMono, fontSize: 11, fontWeight: "normal" },
      icon: "roundRect",
      itemWidth: 8,
      itemHeight: 8,
    },
    xAxis: {
      type: "category",
      axisLine: { lineStyle: { color: theme.hair } },
      axisTick: { lineStyle: { color: theme.hair } },
      splitLine: { show: false, lineStyle: { color: theme.hair } },
      axisLabel: {
        color: theme.muted,
        fontFamily: fMono,
        fontSize: 10.5,
      },
      nameTextStyle: {
        color: theme.muted, fontFamily: fMono, fontSize: 10.5,
      },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false, lineStyle: { color: theme.hair } },
      axisTick: { show: false, lineStyle: { color: theme.hair } },
      splitLine: {
        show: true,
        lineStyle: { color: theme.hair, type: "dashed" },
      },
      axisLabel: {
        color: theme.muted,
        fontFamily: fMono,
        fontSize: 10.5,
      },
      nameTextStyle: {
        color: theme.muted, fontFamily: fMono, fontSize: 10.5,
      },
    },
    aria: { enabled: true },
    // Fonts captured here so charts can pull them in formatters / rich labels.
    _fonts: { fMono, fSans },
  };
}

// ─── Gradient helpers (ECharts gradient object form) ───────────────────────

export function gradient(top, bottom) {
  return {
    type: "linear",
    x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [
      { offset: 0, color: top },
      { offset: 1, color: bottom },
    ],
  };
}

export function gradientH(left, right) {
  return {
    type: "linear",
    x: 0, y: 0, x2: 1, y2: 0,
    colorStops: [
      { offset: 0, color: left },
      { offset: 1, color: right },
    ],
  };
}

export { colorWithAlpha };

// ─── Generic Chart wrapper ─────────────────────────────────────────────────

export function Chart({ build, deps = [], height = 320, className = "" }) {
  const ref = useRef(null);
  const [tick, setTick] = useState(0);

  // Re-render on theme/accent change. The theme system uses CSS variable
  // swaps; an attribute change on <body> or <html style> triggers this
  // remount so ECharts picks up the new palette.
  useEffect(() => {
    const obs = new MutationObserver(() => setTick((t) => t + 1));
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => obs.disconnect();
  }, []);

  let option;
  let buildError = null;
  try {
    const theme = getTheme();
    option = build(theme, baseOptions(theme));
  } catch (err) {
    buildError = err;
    console.error("[Chart] failed to build option:", err);
  }

  if (buildError) {
    return (
      <div
        ref={ref}
        className={className}
        style={{
          height,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontFamily: "var(--f-mono)",
          fontSize: 12,
          textAlign: "center",
          padding: 24,
        }}
      >
        Chart failed to render.
        <br />
        <span style={{ color: "var(--bad)" }}>{String(buildError.message || buildError)}</span>
      </div>
    );
  }

  return (
    <ReactECharts
      // Forcing a fresh instance on theme tick avoids stale palette colors.
      key={tick}
      ref={ref}
      option={option}
      echarts={echarts}
      notMerge={true}
      lazyUpdate={false}
      className={className}
      style={{ height, width: "100%" }}
      opts={{ renderer: "canvas" }}
    />
  );
}
