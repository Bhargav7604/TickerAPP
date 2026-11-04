import React, { useEffect, useRef, useState } from "react";
import { Box, Paper, Stack, TextField, Typography } from "@mui/material";
import { alpha, useTheme as useMuiTheme } from "@mui/material/styles";
import { Segmented, mono } from "../ui/Glass";

const TIME_RANGES = [["full", "Full day"], ["morning", "09:00-11:00"], ["midday", "11:00-13:00"], ["afternoon", "13:00-15:30"], ["last60", "Last 60 min"]];
const INDEX_NAMES = { nifty: "Nifty", banknifty: "Banknifty", sensex: "Sensex" };
export const CHART_TYPES = [["candles", "Candles"], ["line", "Line"], ["area", "Area"], ["columns", "Columns"]];
const TYPE_KEY = "utraders-chart-type";
const chartColors = palette => ({
  index: palette.mode === "dark" ? "#7c9bf2" : "#3f63d8", metric: palette.mode === "dark" ? "#ffa53a" : "#ef8a00",
  up: palette.success.main, down: palette.error.main, grid: palette.divider, axis: palette.text.secondary,
  guide: alpha(palette.text.primary, 0.3), paper: palette.background.paper,
});
const FIVE_MINUTES = 5 * 60 * 1000;
const CANDLE_REFRESH_MS = 60000;
let chartIds = 0;

const readType = () => {
  try {
    const stored = localStorage.getItem(TYPE_KEY);
    return CHART_TYPES.some(([value]) => value === stored) ? stored : "candles";
  } catch { return "candles"; }
};
const saveType = value => { try { localStorage.setItem(TYPE_KEY, value); } catch { /* storage unavailable */ } };

// A little headroom above and below so lines and candle wicks never touch the frame.
const limitsOf = values => {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: 1 };
  const min = Math.min(...finite), max = Math.max(...finite);
  if (min === max) { const pad = Math.max(Math.abs(min) * 0.01, 1); return { min: min - pad, max: max + pad }; }
  const pad = (max - min) * 0.06;
  return { min: min - pad, max: max + pad };
};

/** Without broker candles, each pair of five-minute snapshots becomes one candle (open = earlier, close = later). */
export function snapshotCandles(points) {
  return points.slice(1).map((point, index) => {
    const open = Number(points[index].indexLevel), close = Number(point.indexLevel);
    return { time: points[index].time, open, close, high: Math.max(open, close), low: Math.min(open, close) };
  }).filter(candle => candle.open > 0 && candle.close > 0);
}

// Today's five-minute futures candles from the broker, refreshed every minute while candles are on screen.
function useBrokerCandles(load, key, contractMonth, symbol, enabled) {
  const [state, setState] = useState({ id: "", symbol: "", candles: [] });
  useEffect(() => {
    if (!load || !enabled) return undefined;
    const abort = new AbortController();
    const id = `${key}:${contractMonth}`;
    let timer;
    const run = async () => {
      if (document.visibilityState === "hidden") { timer = setTimeout(run, CANDLE_REFRESH_MS); return; }
      try {
        const result = await load(key, contractMonth, abort.signal);
        if (abort.signal.aborted) return;
        setState({ id, symbol: result.symbol, candles: result.candles.map(candle => ({ ...candle, time: candle.time * 1000 })) });
        timer = setTimeout(run, result.retryAfterMs || CANDLE_REFRESH_MS);
      } catch {
        if (!abort.signal.aborted) timer = setTimeout(run, CANDLE_REFRESH_MS);
      }
    };
    run();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [load, key, contractMonth, enabled]);
  return state.id === `${key}:${contractMonth}` && state.symbol === symbol ? state.candles : null;
}

function LegendDot({ color, shape = "line", children }) {
  return <Stack direction="row" spacing={0.75} alignItems="center" component="span">
    <Box component="span" sx={{ width: shape === "line" ? 14 : 9, height: shape === "line" ? 3 : 9, borderRadius: shape === "line" ? 2 : 0.5, bgcolor: color }} />
    <Typography component="span" sx={{ fontSize: 12, fontWeight: 700, color: "text.secondary" }}>{children}</Typography>
  </Stack>;
}

export default function MarketChart({ dashboard, sx }) {
  const COLORS = chartColors(useMuiTheme().palette);
  const scrollRef = useRef(null);
  const idRef = useRef(null);
  if (idRef.current === null) idRef.current = ++chartIds;
  const [containerWidth, setContainerWidth] = useState(800);
  const [selectedTime, setSelectedTime] = useState(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [type, setType] = useState(readType);
  const key = dashboard.state.selectedChartIndex;
  const allPoints = dashboard.getChartPoints(key);
  const range = dashboard.getSelectedChartTimeRange(allPoints);
  const inRange = time => { const minute = dashboard.getMinutesOfDay(time); return minute >= range.start && minute <= range.end; };
  const points = allPoints.filter(point => inRange(point.time));
  const field = dashboard.state.selectedChartMetric;
  const metricLabel = field === "ratio" ? "Ratio" : "Net lots";
  const symbol = dashboard.getCurrentSymbol(key);
  const contractMonth = dashboard.props.settings.contractMonth || "current";
  const brokerCandles = useBrokerCandles(dashboard.props.loadCandles, key, contractMonth, symbol, type === "candles");
  const fromBroker = Boolean(brokerCandles?.length);
  const candles = type !== "candles" ? [] : (fromBroker ? brokerCandles : snapshotCandles(allPoints))
    .filter(candle => inRange(candle.time) && dashboard.getMinutesOfDay(candle.time) < range.end);
  const ticks = dashboard.getMarketAxisMinutes(range.start, range.end);
  const height = containerWidth < 600 ? 240 : 340;
  const padding = { left: 64, right: 58, top: 16, bottom: 28 };
  const width = Math.max(containerWidth, padding.left + padding.right + (ticks.length - 1) * 42);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const priceRange = limitsOf([...points.map(point => Number(point.indexLevel)), ...candles.flatMap(candle => [candle.high, candle.low])]);
  const baseline = field === "ratio" ? 1 : 0;
  const metricValues = points.map(point => Number(point[field]));
  const lotsRange = limitsOf(type === "columns" ? [...metricValues, baseline] : metricValues);
  const minuteX = minute => padding.left + (minute - range.start) / (range.end - range.start) * plotWidth;
  const xScale = point => minuteX(dashboard.getMinutesOfDay(point.time));
  const yScale = (value, limits) => padding.top + (limits.max - value) / (limits.max - limits.min) * plotHeight;
  const slot = plotWidth / ((range.end - range.start) / 5);
  const barWidth = Math.max(3, Math.min(16, slot * 0.62));
  const selected = points.find(point => point.time === selectedTime);
  const selectedCandle = selected && candles.find(candle => selected.time >= candle.time && selected.time < candle.time + FIVE_MINUTES);
  const latestTime = points[points.length - 1]?.time;
  const showIndexLine = type !== "candles";
  const showMetricLine = type !== "columns";
  const formatMetric = value => field === "ratio" ? dashboard.formatValue(value) : dashboard.formatSignedValue(value);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const resize = () => setContainerWidth(element.clientWidth || 800);
    resize();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setSelectedTime(null); }, [key, symbol, field, range.value]);

  // Keep the latest sample in view without repeatedly moving a user's scroll position.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !latestTime) return;
    const minute = dashboard.getMinutesOfDay(latestTime);
    const x = padding.left + ((minute - range.start) / (range.end - range.start)) * plotWidth;
    element.scrollLeft = Math.max(0, x - element.clientWidth + padding.right + 40);
  }, [key, symbol, range.start, range.end, latestTime, plotWidth, dashboard, padding.left, padding.right]);

  const chooseType = value => { setType(value); saveType(value); };
  const selectAtPointer = event => {
    if (!points.length) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) * width / rect.width;
    const minute = range.start + (x - padding.left) / plotWidth * (range.end - range.start);
    const closest = points.reduce((best, point) => Math.abs(dashboard.getMinutesOfDay(point.time) - minute) < Math.abs(dashboard.getMinutesOfDay(best.time) - minute) ? point : best);
    setSelectedTime(closest.time);
  };
  const selectWithKeys = event => {
    if (event.key === "Escape") { setSelectedTime(null); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !points.length) return;
    event.preventDefault();
    const current = Math.max(0, points.findIndex(point => point.time === selectedTime));
    const next = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.min(points.length - 1, Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1)));
    const point = points[next];
    setSelectedTime(point.time);
    const element = scrollRef.current;
    const x = xScale(point);
    if (x < element.scrollLeft + padding.left || x > element.scrollLeft + element.clientWidth - padding.right) element.scrollLeft = x - element.clientWidth / 2;
  };

  const linePath = (series, valueOf, limits) => series
    .filter(point => Number.isFinite(Number(valueOf(point))))
    .map((point, index) => `${index ? "L" : "M"} ${xScale(point).toFixed(1)} ${yScale(Number(valueOf(point)), limits).toFixed(1)}`).join(" ");
  const indexPath = linePath(points, point => point.indexLevel, priceRange);
  const areaPath = points.length > 1 ? `${indexPath} L ${xScale(points[points.length - 1]).toFixed(1)} ${height - padding.bottom} L ${xScale(points[0]).toFixed(1)} ${height - padding.bottom} Z` : "";
  const gradientId = `chart-area-${idRef.current}`;

  const hasData = points.length > 0 || candles.length > 0;
  const axis = (limits, side, color, digits) => (
    <Box aria-hidden="true" sx={{ position: "absolute", top: 0, bottom: padding.bottom, [side]: 0, width: side === "left" ? padding.left : padding.right, bgcolor: "background.paper", pointerEvents: "none" }}>
      {hasData && [0, 0.25, 0.5, 0.75, 1].map(step => <Box component="span" key={step} sx={{
        position: "absolute", top: padding.top + step * plotHeight, transform: "translateY(-50%)", [side === "left" ? "right" : "left"]: 8,
        ...mono, fontSize: 11, fontWeight: 600, color, whiteSpace: "nowrap",
      }}>{(limits.max - step * (limits.max - limits.min)).toLocaleString("en-IN", { maximumFractionDigits: digits })}</Box>)}
    </Box>
  );
  const selectedLabel = selected ? dashboard.formatTime(selected.time) + " | Index " + dashboard.formatValue(selected.indexLevel) + " | " + metricLabel + " " + dashboard.formatSignedValue(selected[field]) : "No chart sample selected";
  const selectProps = label => ({ select: true, size: "small", SelectProps: { native: true }, inputProps: { "aria-label": label }, sx: { minWidth: 0, "& select": { py: 0.75, fontSize: 13, fontWeight: 700 } } });

  return (
    <Paper component="section" className="scan-chart-section" aria-label="Market history" sx={{ minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", ...sx }}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1.25} justifyContent="space-between" alignItems={{ md: "center" }} sx={{ px: 2, pt: 1.75, pb: 1 }}>
        <Typography variant="h3" component="h2" sx={{ fontSize: "1rem", whiteSpace: "nowrap" }}>{INDEX_NAMES[key]} · {metricLabel} vs index</Typography>
        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
          <Segmented label="chart type" value={type} options={CHART_TYPES} onChange={chooseType} />
          <TextField {...selectProps("chart index")} value={key} onChange={dashboard.handleChartIndexChange}>
            {Object.entries(INDEX_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </TextField>
          <TextField {...selectProps("chart right metric")} value={field} onChange={dashboard.handleChartMetricChange}>
            <option value="netLots">Net lots</option><option value="ratio">Ratio</option>
          </TextField>
          <TextField {...selectProps("chart time range")} value={range.value} onChange={dashboard.handleChartTimeRangeChange}>
            {TIME_RANGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </TextField>
        </Stack>
      </Stack>

      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="center" sx={{ px: 2, pb: 0.5 }}>
        {type === "candles"
          ? <><LegendDot color={COLORS.up} shape="box">Index candle up</LegendDot><LegendDot color={COLORS.down} shape="box">down (left)</LegendDot></>
          : <LegendDot color={COLORS.index} shape={type === "area" ? "box" : "line"}>Index (left)</LegendDot>}
        {type === "columns"
          ? <><LegendDot color={COLORS.up} shape="box">{metricLabel} up</LegendDot><LegendDot color={COLORS.down} shape="box">down (right)</LegendDot></>
          : <LegendDot color={COLORS.metric}>{metricLabel} (right)</LegendDot>}
        {type === "candles" && <Typography variant="caption" color="text.secondary" sx={{ ml: { sm: "auto" } }}>
          {fromBroker ? "Zerodha 5-minute futures candles" : "Candles built from 5-minute snapshots"}
        </Typography>}
      </Stack>

      <Box sx={{ position: "relative", flex: 1 }}>
        <Box ref={scrollRef} tabIndex={0} role="group" aria-label={symbol + " five-minute chart"} onKeyDown={selectWithKeys}
          onScroll={event => setScrollOffset(event.currentTarget.scrollLeft)}
          sx={{ overflowX: "auto", overflowY: "hidden", outline: "none", "&:focus-visible": { boxShadow: "inset 0 0 0 2px rgba(74,111,224,0.5)" } }}>
          <svg style={{ width, height, display: "block", touchAction: "pan-x" }} viewBox={`0 0 ${width} ${height}`}
            role="img" aria-label={symbol + " index and " + metricLabel.toLowerCase()}
            onPointerDown={selectAtPointer} onPointerMove={selectAtPointer}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.index} stopOpacity="0.28" />
                <stop offset="100%" stopColor={COLORS.index} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map(step => <line key={step} x1={padding.left} x2={width - padding.right} y1={padding.top + step * plotHeight} y2={padding.top + step * plotHeight} stroke={COLORS.grid} />)}
            {ticks.map((minutes, index) => <text key={minutes} x={minuteX(minutes)} y={height - 9} fontSize="11" fill={COLORS.axis} fontFamily="inherit"
              textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}>{dashboard.formatMarketTime(minutes)}</text>)}

            {type === "columns" && <>
              <line x1={padding.left} x2={width - padding.right} y1={yScale(baseline, lotsRange)} y2={yScale(baseline, lotsRange)} stroke={COLORS.guide} strokeDasharray="4 4" />
              {points.filter(point => Number.isFinite(Number(point[field]))).map(point => {
                const value = Number(point[field]);
                const top = Math.min(yScale(value, lotsRange), yScale(baseline, lotsRange));
                return <rect key={point.time} x={xScale(point) - barWidth / 2} y={top} width={barWidth} rx="2"
                  height={Math.max(1, Math.abs(yScale(value, lotsRange) - yScale(baseline, lotsRange)))}
                  fill={value >= baseline ? COLORS.up : COLORS.down} opacity={point.time === selectedTime ? 1 : 0.78} />;
              })}
            </>}

            {type === "area" && areaPath && <path d={areaPath} fill={`url(#${gradientId})`} />}

            {candles.map(candle => {
              const center = minuteX(dashboard.getMinutesOfDay(candle.time) + 2.5);
              const color = candle.close >= candle.open ? COLORS.up : COLORS.down;
              const top = yScale(Math.max(candle.open, candle.close), priceRange);
              return <g key={candle.time}>
                <line x1={center} x2={center} y1={yScale(candle.high, priceRange)} y2={yScale(candle.low, priceRange)} stroke={color} strokeWidth="1.2" />
                <rect x={center - barWidth / 2} y={top} width={barWidth} rx="1.5"
                  height={Math.max(1.2, yScale(Math.min(candle.open, candle.close), priceRange) - top)} fill={color} />
              </g>;
            })}

            {showIndexLine && points.length > 1 && <path d={indexPath} fill="none" stroke={COLORS.index} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />}
            {showMetricLine && points.length > 1 && <path d={linePath(points, point => point[field], lotsRange)} fill="none" stroke={COLORS.metric} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
            {points.length === 1 && <>
              {showIndexLine && <circle cx={xScale(points[0])} cy={yScale(points[0].indexLevel, priceRange)} r="4" fill={COLORS.index} />}
              {showMetricLine && Number.isFinite(Number(points[0][field])) && <circle cx={xScale(points[0])} cy={yScale(points[0][field], lotsRange)} r="4" fill={COLORS.metric} />}
            </>}

            {selected && <g>
              <line x1={xScale(selected)} x2={xScale(selected)} y1={padding.top} y2={height - padding.bottom} stroke={COLORS.guide} strokeDasharray="3 3" />
              {showIndexLine && <circle cx={xScale(selected)} cy={yScale(selected.indexLevel, priceRange)} r="5" fill={COLORS.paper} stroke={COLORS.index} strokeWidth="2.5" />}
              {showMetricLine && Number.isFinite(Number(selected[field])) && <circle cx={xScale(selected)} cy={yScale(selected[field], lotsRange)} r="5" fill={COLORS.paper} stroke={COLORS.metric} strokeWidth="2.5" />}
            </g>}
          </svg>
        </Box>
        {axis(priceRange, "left", COLORS.index, 0)}
        {axis(lotsRange, "right", type === "columns" ? "text.secondary" : COLORS.metric, field === "ratio" ? 2 : 0)}
        {selected && <Paper role="tooltip" sx={{
          position: "absolute", top: 12, left: Math.max(70, Math.min(xScale(selected) - scrollOffset + 12, containerWidth - 220)), px: 1.5, py: 1, minWidth: 170,
          pointerEvents: "none", boxShadow: "0 8px 24px rgba(16,24,40,0.16)", "& div": { display: "flex", justifyContent: "space-between", gap: 2, fontSize: 12 }, "& b": mono,
        }}>
          <Typography sx={{ ...mono, fontWeight: 800, fontSize: 13, mb: 0.5 }}>{dashboard.formatTime(selected.time)}</Typography>
          <div><span>Index</span><b>{dashboard.formatValue(selected.indexLevel)}</b></div>
          {selectedCandle && <div><span>O / H / L / C</span><b>{[selectedCandle.open, selectedCandle.high, selectedCandle.low, selectedCandle.close].map(value => Math.round(value).toLocaleString("en-IN")).join(" / ")}</b></div>}
          <div><span>{metricLabel}</span><b>{formatMetric(selected[field])}</b></div>
        </Paper>}
        {!hasData && <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "text.secondary", fontWeight: 700, fontSize: 14, pointerEvents: "none" }}>
          No snapshots in this window
        </Box>}
      </Box>

      <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap" alignItems="center" aria-live="polite" aria-label="Selected chart sample"
        sx={{ px: 2, py: 1, bgcolor: "background.subtle", fontSize: 12.5, color: "text.secondary", minHeight: 38, "& b": { ...mono, color: "text.primary" } }}>
        {selected ? <>
          <Box component="strong" sx={{ ...mono, color: "text.primary" }}>{dashboard.formatTime(selected.time)}</Box>
          <span>Index <b>{dashboard.formatValue(selected.indexLevel)}</b></span>
          <span>{metricLabel} <b>{dashboard.formatSignedValue(selected[field])}</b></span>
          {selectedCandle && <span>Candle <b>{selectedCandle.close >= selectedCandle.open ? "up" : "down"} {dashboard.formatSignedValue(Math.round(selectedCandle.close - selectedCandle.open))}</b></span>}
        </> : <span>{symbol} · {range.label} · 5-minute samples · tap or use arrow keys to inspect</span>}
        <span className="sr-only">{selectedLabel}</span>
      </Stack>
    </Paper>
  );
}
