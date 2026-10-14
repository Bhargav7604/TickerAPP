import React, { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, ColorType } from "lightweight-charts";
import { X } from "lucide-react";
import { formatPrice, formatLots } from "../equityData";
import { useTheme } from "../theme";

const timeLabel = time => new Date(Number(time) * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
const chartColors = {
  light: { background: "#ffffff", text: "#60646c", grid: "#ededf0", border: "#e4e4e7", price: "#1763f5", volume: "#c9dafe" },
  dark: { background: "#202124", text: "#b0b4bd", grid: "#33363c", border: "#373a40", price: "#78a9ff", volume: "#3c5177" },
  terminal: { background: "#000000", text: "#cccccc", grid: "#242424", border: "#666666", price: "#59a5ff", volume: "#967042" },
};

export default function EquityChart({ contract, candles, message, loading, terminal = false, onClose }) {
  const container = useRef(null);
  const instance = useRef(null);
  const { theme } = useTheme();
  const [range, setRange] = useState("session");
  const [hover, setHover] = useState(null);
  useEffect(() => {
    setHover(null);
    if (!container.current || !candles.length) return undefined;
    const cutoff = range === "session" ? 0 : candles[candles.length - 1].time - Number(range) * 60;
    const points = [...new Map(candles.filter(point => Number.isFinite(point.close) && point.time >= cutoff)
      .map(point => [point.time, point])).values()].sort((a, b) => a.time - b.time);
    if (!points.length) return undefined;
    const chart = createChart(container.current, {
      height: terminal ? container.current.clientHeight || 220 : 170, autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#ffffff" }, textColor: "#607087", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', attributionLogo: true },
      grid: { vertLines: { color: "#edf1f6" }, horzLines: { color: "#edf1f6" } },
      rightPriceScale: { borderColor: "#e3e9f1", scaleMargins: { top: .12, bottom: .28 } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#e3e9f1", tickMarkFormatter: timeLabel },
      localization: { timeFormatter: timeLabel, priceFormatter: formatPrice },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    const hasOhlc = terminal && points.every(point => [point.open, point.high, point.low].every(Number.isFinite));
    const price = chart.addSeries(hasOhlc ? CandlestickSeries : LineSeries, hasOhlc ? {
      upColor: "#00b83e", downColor: "#ed2424", wickUpColor: "#00b83e", wickDownColor: "#ed2424", borderVisible: false, priceLineVisible: false,
    } : { color: "#1763f5", lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
    const volume = chart.addSeries(HistogramSeries, { color: "#c9dafe", priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 } });
    price.setData(points.map(point => hasOhlc ? { time: point.time, open: point.open, high: point.high, low: point.low, close: point.close } : { time: point.time, value: point.close }));
    volume.setData(points.filter(point => Number.isFinite(point.volume)).map(point => ({ time: point.time, value: point.volume })));
    chart.timeScale().fitContent();
    let frame;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => chart.timeScale().fitContent());
    });
    observer.observe(container.current);
    chart.subscribeCrosshairMove(event => setHover(event.time ? points.find(point => point.time === event.time) || null : null));
    instance.current = { chart, price, volume, hasOhlc };
    return () => { instance.current = null; observer.disconnect(); cancelAnimationFrame(frame); chart.remove(); };
  }, [candles, range, contract.id, terminal]);
  useEffect(() => {
    if (!instance.current) return;
    const colors = chartColors[terminal ? "terminal" : theme];
    const { chart, price, volume, hasOhlc } = instance.current;
    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.border }, timeScale: { borderColor: colors.border },
    });
    if (!hasOhlc) price.applyOptions({ color: colors.price });
    volume.applyOptions({ color: colors.volume });
  }, [theme, candles, range, contract.id, terminal]);
  return <section className="eq-chart" aria-label={`${contract.symbol} five-minute chart`}>
    <header><div><strong>{contract.underlying}</strong><span>{contract.symbol} / 5 min</span></div>
      <div className="eq-chart-controls"><select aria-label="Chart time range" value={range} onChange={event => setRange(event.target.value)}>
        <option value="session">Today</option><option value="60">Last 60 min</option><option value="30">Last 30 min</option>
      </select>{terminal && <button className="eq-icon" title="Close chart" aria-label="Collapse chart panel" onClick={onClose}><X size={16} /></button>}</div>
    </header>
    {candles.length ? <div className="eq-chart-canvas" ref={container} /> :
      <div className="eq-chart-empty" role="status">{loading ? "Loading chart..." : message || "No five-minute candles available for this session."}</div>}
    <footer><span>{hover ? `${timeLabel(hover.time)} IST` : "5-minute candles"}</span>
      <span>Price <b>{formatPrice(hover?.close ?? candles[candles.length - 1]?.close)}</b></span>
      {terminal && ["open", "high", "low"].map(key => <span key={key}>{key.toUpperCase()} <b>{formatPrice((hover ?? candles[candles.length - 1])?.[key])}</b></span>)}
      <span>Volume <b>{formatLots(hover?.volume ?? candles[candles.length - 1]?.volume)} lots</b></span>
    </footer>
  </section>;
}
