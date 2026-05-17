// web/src/lib/chartBase.jsx
//
// Highcharts setup, theming, and the shared <Chart> wrapper component.
// Every chart in components/charts.jsx mounts through here.
//
// To swap charting libraries (e.g. Highcharts → ECharts), this file is the
// only one that touches the chart library directly. See LICENSING.md
// Option C for the swap path.

import React, { useEffect, useRef, useState } from "react";
import Highcharts from "highcharts";
import "highcharts/highcharts-more";       // waterfall, paired column
import "highcharts/modules/solid-gauge";   // cache gauge
import "highcharts/modules/accessibility"; // a11y descriptions for charts

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

export function baseOptions(theme) {
  const fMono = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace';
  const fSans = '"Geist", ui-sans-serif, system-ui, sans-serif';

  return {
    chart: {
      backgroundColor: "transparent",
      style: { fontFamily: fSans, color: theme.ink },
      animation: { duration: 800 },
      spacing: [10, 4, 14, 4],
    },
    colors: [theme.info, theme.val, theme.warn, theme.bad, theme.accent, theme.ink2],
    title:    { text: undefined },
    subtitle: { text: undefined },
    credits:  { enabled: false },
    legend: {
      itemStyle: { color: theme.ink2, fontFamily: fMono, fontSize: "11px", fontWeight: "400" },
      itemHoverStyle: { color: theme.ink },
      itemHiddenStyle: { color: theme.muted },
      symbolHeight: 8, symbolWidth: 8, symbolRadius: 2,
    },
    xAxis: {
      lineColor: theme.hair,
      tickColor: theme.hair,
      gridLineColor: theme.hair,
      labels: { style: { color: theme.muted, fontFamily: fMono, fontSize: "10.5px" } },
      title:  { style: { color: theme.muted, fontFamily: fMono, fontSize: "10.5px",
                         letterSpacing: "0.06em", textTransform: "uppercase" } },
    },
    yAxis: {
      lineColor: theme.hair,
      tickColor: theme.hair,
      gridLineColor: theme.hair,
      gridLineDashStyle: "Dash",
      labels: { style: { color: theme.muted, fontFamily: fMono, fontSize: "10.5px" } },
      title:  { style: { color: theme.muted, fontFamily: fMono, fontSize: "10.5px",
                         letterSpacing: "0.06em", textTransform: "uppercase" } },
    },
    tooltip: {
      useHTML: true,
      backgroundColor: theme.panel,
      borderColor: theme.hairStr,
      borderRadius: 8,
      borderWidth: 1,
      shadow: false,
      padding: 10,
      style: { color: theme.ink, fontFamily: fSans, fontSize: "12.5px" },
      headerFormat:
        `<div style="font-family:${fMono};font-size:10px;letter-spacing:.08em;` +
        `color:${theme.muted};text-transform:uppercase;margin-bottom:4px;">{point.key}</div>`,
      pointFormat:
        `<span style="color:{point.color};">●</span> <b>{series.name}</b>: ` +
        `<span style="font-family:${fMono};">{point.y}</span>`,
    },
    plotOptions: {
      series: {
        animation: { duration: 900 },
        states: {
          hover:    { brightness: 0.1, halo: { size: 6, opacity: 0.18 } },
          inactive: { opacity: 0.35 },
        },
        dataLabels: {
          style: { color: theme.ink, fontFamily: fMono, fontSize: "11px",
                   textOutline: "none", fontWeight: "500" },
        },
        marker: { lineWidth: 0 },
      },
      column: { borderWidth: 0, borderRadius: 4, groupPadding: 0.1, pointPadding: 0.04 },
      bar:    { borderWidth: 0, borderRadius: 4, groupPadding: 0.1, pointPadding: 0.04 },
    },
    accessibility: { enabled: true },
  };
}

export function gradient(top, bottom) {
  return {
    linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    stops: [[0, top], [1, bottom]],
  };
}

export function gradientH(left, right) {
  return {
    linearGradient: { x1: 0, y1: 0, x2: 1, y2: 0 },
    stops: [[0, left], [1, right]],
  };
}

export { colorWithAlpha };

// ─── Generic Chart wrapper ─────────────────────────────────────────────────

export function Chart({ build, deps = [], height = 320, className = "" }) {
  const ref = useRef(null);
  const [tick, setTick] = useState(0);

  // Re-render on theme/accent change. The Counter/theme system uses CSS
  // variable swaps; an attribute change on <body> or <html style> triggers
  // this remount so Highcharts picks up the new palette.
  useEffect(() => {
    const obs = new MutationObserver(() => setTick((t) => t + 1));
    obs.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const theme = getTheme();
    let chart;
    try {
      const opts = build(theme, baseOptions(theme));
      chart = Highcharts.chart(ref.current, opts);
    } catch (err) {
      console.error("[Chart] failed to render:", err);
      if (ref.current) {
        ref.current.innerHTML =
          `<div style="display:flex;align-items:center;justify-content:center;` +
          `height:100%;color:var(--muted);font-family:var(--f-mono);font-size:12px;` +
          `text-align:center;padding:24px;">Chart failed to render.<br/>` +
          `<span style="color:var(--bad);">${String(err.message || err)}</span></div>`;
      }
    }
    return () => { try { chart && chart.destroy(); } catch { /* noop */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  return <div ref={ref} className={className} style={{ height, width: "100%" }} />;
}
