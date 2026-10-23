import React, { useEffect, useRef, useState } from "react";
import { createChart, ColorType, HistogramSeries, LineSeries } from "lightweight-charts";
import { compactOi, formatPrice, timeLabel } from "../oiData";
import { useTheme } from "../theme";

const COLORS = {
  light: { background: "#ffffff", text: "#5b6579", grid: "#e9edf4", border: "#e1e7f0", spot: "#3653d4", up: "rgba(10, 124, 85, 0.35)", down: "rgba(200, 48, 59, 0.35)" },
  dark: { background: "#0e1320", text: "#95a1b7", grid: "#1a2232", border: "#212b40", spot: "#86abf4", up: "rgba(79, 209, 165, 0.35)", down: "rgba(255, 123, 134, 0.35)" },
};
const CALL = "#e5484d";
const PUT = "#1fb88a";

// Call vs put OI change through the session, the put-minus-call difference as bars, and the index on its own scale.
export default function OiTrendChart({ series }) {
  const container = useRef(null);
  const chartRef = useRef(null);
  const { theme } = useTheme();
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!container.current || !series.length) return undefined;
    const colors = COLORS[theme] || COLORS.light;
    const chart = createChart(container.current, {
      height: 320, autoSize: true,
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', attributionLogo: true },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      leftPriceScale: { visible: true, borderColor: colors.border },
      rightPriceScale: { visible: true, borderColor: colors.border },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: colors.border, tickMarkFormatter: timeLabel },
      localization: { timeFormatter: timeLabel, priceFormatter: compactOi },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    const diff = chart.addSeries(HistogramSeries, { priceScaleId: "left", priceLineVisible: false, lastValueVisible: false });
    const call = chart.addSeries(LineSeries, { color: CALL, lineWidth: 2, priceScaleId: "left", priceLineVisible: false });
    const put = chart.addSeries(LineSeries, { color: PUT, lineWidth: 2, priceScaleId: "left", priceLineVisible: false });
    const spot = chart.addSeries(LineSeries, { color: colors.spot, lineWidth: 1, lineStyle: 2, priceScaleId: "right", priceLineVisible: false,
      priceFormat: { type: "custom", formatter: formatPrice } });
    diff.setData(series.map(row => ({ time: row.time, value: row.diff, color: row.diff >= 0 ? colors.up : colors.down })));
    call.setData(series.map(row => ({ time: row.time, value: row.callOiChange })));
    put.setData(series.map(row => ({ time: row.time, value: row.putOiChange })));
    spot.setData(series.filter(row => Number.isFinite(row.underlying)).map(row => ({ time: row.time, value: row.underlying })));
    chart.timeScale().fitContent();
    chart.subscribeCrosshairMove(event => setHover(event.time ? series.find(row => row.time === event.time) || null : null));
    chartRef.current = chart;
    return () => { chartRef.current = null; chart.remove(); };
  }, [series, theme]);

  const shown = hover || series[series.length - 1];
  return <div className="oi-chart">
    <div className="oi-chart-legend" aria-live="polite">
      <span>{shown ? `${timeLabel(shown.time)} IST` : "--"}</span>
      <span className="oi-legend-call">Call OI chg <b>{compactOi(shown?.callOiChange)}</b></span>
      <span className="oi-legend-put">Put OI chg <b>{compactOi(shown?.putOiChange)}</b></span>
      <span className="oi-legend-diff">Put − Call <b>{compactOi(shown?.diff)}</b></span>
      <span className="oi-legend-spot">Index <b>{formatPrice(shown?.underlying)}</b></span>
    </div>
    {series.length ? <div className="oi-chart-canvas" ref={container} role="img"
      aria-label={`OI change chart with ${series.length} samples`} /> : <div className="oi-empty">No OI samples yet.</div>}
  </div>;
}
