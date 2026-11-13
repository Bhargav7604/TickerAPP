import React, { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import { CandlestickSeries, ColorType, createChart } from "lightweight-charts";
import { useTheme } from "../theme";

const COLORS = {
  light: { background: "#ffffff", text: "#5b6579", grid: "#eef1f6", border: "#e1e7f0" },
  dark: { background: "#121a2a", text: "#97a3b8", grid: "#1a2232", border: "#212b40" },
};
const UP = "#1fb88a";
const DOWN = "#e5484d";
export const STEP_SECONDS = { minute: 60, "5minute": 300, "15minute": 900, "60minute": 3600, day: 86400 };
const VISIBLE_BARS = 120;

const timeText = (time, interval) => new Date(Number(time) * 1000).toLocaleString("en-GB", interval === "day"
  ? { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }
  : { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

/** A live price folded into the candles: the current candle grows, or the next one starts. null when it does not apply. */
export function applyTick(candles, price, tradedAt, interval) {
  const last = candles[candles.length - 1];
  if (!last || !Number.isFinite(price) || !Number.isFinite(tradedAt) || tradedAt < last.time) return null;
  const step = STEP_SECONDS[interval];
  if (tradedAt < last.time + step) {
    return { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
  }
  return { time: last.time + Math.floor((tradedAt - last.time) / step) * step, open: price, high: price, low: price, close: price };
}

export default function LiveChart({ candles, live, interval, precision = 2, label }) {
  const box = useRef(null);
  const chart = useRef(null);
  const series = useRef(null);
  const bars = useRef([]);
  const shown = useRef(null);
  const { theme } = useTheme();

  useEffect(() => {
    chart.current = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: COLORS.light.background }, textColor: COLORS.light.text, fontFamily: "inherit", attributionLogo: true },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 3 },
      rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.08 } },
      // The page scrolls with the mouse wheel; drag and pinch move and zoom the chart.
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    series.current = chart.current.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false, priceLineVisible: true,
    });
    return () => { chart.current.remove(); chart.current = null; series.current = null; };
  }, []);

  useEffect(() => {
    const colors = COLORS[theme] || COLORS.light;
    chart.current.applyOptions({
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.border }, timeScale: { borderColor: colors.border },
    });
  }, [theme]);

  useEffect(() => {
    chart.current.applyOptions({ localization: { timeFormatter: time => timeText(time, interval) }, timeScale: { tickMarkFormatter: time => timeText(time, interval) } });
    series.current.applyOptions({ priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision } });
  }, [interval, precision]);

  useEffect(() => {
    const data = [...new Map(candles.filter(bar => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
      .map(bar => [bar.time, { time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close }])).values()]
      .sort((a, b) => a.time - b.time);
    series.current.setData(data);
    bars.current = data;
    // Frame the latest candles once per candle size; later refreshes keep the trader's own zoom.
    if (data.length && shown.current !== interval) {
      chart.current.timeScale().setVisibleLogicalRange({ from: Math.max(0, data.length - VISIBLE_BARS), to: data.length + 3 });
      shown.current = interval;
    }
  }, [candles, interval]);

  useEffect(() => {
    const bar = applyTick(bars.current, live?.ltp, live?.tradedAt, interval);
    if (!bar) return;
    series.current.update(bar);
    const last = bars.current[bars.current.length - 1];
    bars.current = bar.time === last.time ? [...bars.current.slice(0, -1), bar] : [...bars.current, bar];
  }, [live?.ltp, live?.tradedAt, interval]);

  return <Box ref={box} role="img" aria-label={`${label} candlestick chart`} sx={{ position: "absolute", inset: 0 }} />;
}
