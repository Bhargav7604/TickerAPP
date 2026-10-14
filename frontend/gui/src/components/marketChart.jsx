import React, { useEffect, useRef, useState } from "react";

const TIME_RANGES = [["full", "Full day"], ["morning", "09:00-11:00"], ["midday", "11:00-13:00"], ["afternoon", "13:00-15:30"], ["last60", "Last 60 min"]];
const INDEX_NAMES = { nifty: "Nifty", banknifty: "Banknifty", sensex: "Sensex" };

export default function MarketChart({ dashboard }) {
  const scrollRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [selectedTime, setSelectedTime] = useState(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const key = dashboard.state.selectedChartIndex;
  const allPoints = dashboard.getChartPoints(key);
  const range = dashboard.getSelectedChartTimeRange(allPoints);
  const points = allPoints.filter(p => {
    const minute = dashboard.getMinutesOfDay(p.time);
    return minute >= range.start && minute <= range.end;
  });
  const field = dashboard.state.selectedChartMetric;
  const metricLabel = field === "ratio" ? "Ratio" : "Net lots";
  const symbol = dashboard.getCurrentSymbol(key);
  const ticks = dashboard.getMarketAxisMinutes(range.start, range.end);
  const height = containerWidth < 600 ? 166 : 254;
  const padding = { left: 68, right: 60, top: 18, bottom: 28 };
  const width = Math.max(containerWidth, padding.left + padding.right + (ticks.length - 1) * 42);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const priceRange = dashboard.getRange(points, "indexLevel");
  const lotsRange = dashboard.getRange(points, field);
  const xScale = point => padding.left + ((dashboard.getMinutesOfDay(point.time) - range.start) / (range.end - range.start)) * plotWidth;
  const yScale = (value, limits) => padding.top + (limits.max - value) / (limits.max - limits.min) * plotHeight;
  const selected = points.find(p => p.time === selectedTime);
  const latestTime = points[points.length - 1]?.time;

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
    const current = Math.max(0, points.findIndex(p => p.time === selectedTime));
    const next = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.min(points.length - 1, Math.max(0, current + (event.key === "ArrowRight" ? 1 : -1)));
    const point = points[next];
    setSelectedTime(point.time);
    const element = scrollRef.current;
    const x = xScale(point);
    if (x < element.scrollLeft + padding.left || x > element.scrollLeft + element.clientWidth - padding.right) element.scrollLeft = x - element.clientWidth / 2;
  };
  const axisValues = (limits, className) => (
    <div className={"scan-chart-axis " + className} style={{ top: padding.top, bottom: padding.bottom }}>
      {[0, 0.5, 1].map(step => <span key={step} style={{ top: step * 100 + "%" }}>{(limits.max - step * (limits.max - limits.min)).toLocaleString("en-IN", { maximumFractionDigits: field === "ratio" && className === "scan-right-axis" ? 2 : 1 })}</span>)}
    </div>
  );
  const selectedLabel = selected ? dashboard.formatTime(selected.time) + " | Index " + dashboard.formatValue(selected.indexLevel) + " | " + metricLabel + " " + dashboard.formatSignedValue(selected[field]) : "No chart sample selected";
  return (
    <section className="scan-chart-section" aria-label="Market history">
      <div className="scan-chart-toolbar">
        <h2><span className="desktop-chart-index">{INDEX_NAMES[key]} · </span>{metricLabel} vs index</h2>
        <div className="scan-chart-controls">
          <select aria-label="chart index" value={key} onChange={dashboard.handleChartIndexChange}>
            {Object.entries(INDEX_NAMES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select aria-label="chart right metric" value={field} onChange={dashboard.handleChartMetricChange}>
            <option value="netLots">Net lots</option><option value="ratio">Ratio</option>
          </select>
          <select aria-label="chart time range" value={range.value} onChange={dashboard.handleChartTimeRangeChange}>
            {TIME_RANGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </div>
      <div className="scan-chart-legend"><span className="series-index">Index (left)</span><span className="series-lots">{metricLabel} (right)</span></div>
      <div className="scan-chart-frame">
        <div className="scan-chart-scroll" ref={scrollRef} tabIndex="0" role="group" aria-label={symbol + " five-minute chart"} onKeyDown={selectWithKeys} onScroll={event => setScrollOffset(event.currentTarget.scrollLeft)}>
          <svg className="scan-chart-svg" style={{ width, height }} viewBox={`0 0 ${width} ${height}`}
            role="img" aria-label={symbol + " index and " + metricLabel.toLowerCase()}
            onPointerDown={selectAtPointer} onPointerMove={selectAtPointer}>
            {ticks.map(minutes => {
              const x = padding.left + (minutes - range.start) / (range.end - range.start) * plotWidth;
              return <g key={minutes}><line className="scan-grid" x1={x} x2={x} y1={padding.top} y2={height - padding.bottom} />
                <text className="scan-axis-label" x={x} y={height - 8}>{dashboard.formatMarketTime(minutes)}</text></g>;
            })}
            {[0, 0.25, 0.5, 0.75, 1].map(step => <line key={step} className="scan-grid" x1={padding.left} x2={width - padding.right} y1={padding.top + step * plotHeight} y2={padding.top + step * plotHeight} />)}
            {points.length > 1 && <>
              <path className="scan-price-line" d={dashboard.buildPath(points, "indexLevel", xScale, value => yScale(value, priceRange))} />
              <path className="scan-lots-line" d={dashboard.buildPath(points, field, xScale, value => yScale(value, lotsRange))} />
            </>}
            {points.map(point => <g key={point.time}>
              <circle className="scan-price-point" cx={xScale(point)} cy={yScale(point.indexLevel, priceRange)} r={points.length === 1 ? 4 : 2} />
              {Number.isFinite(Number(point[field])) && <circle className="scan-lots-point" cx={xScale(point)} cy={yScale(point[field], lotsRange)} r={points.length === 1 ? 4 : 2} />}
            </g>)}
            {selected && <g className="scan-selection">
              <line x1={xScale(selected)} x2={xScale(selected)} y1={padding.top} y2={height - padding.bottom} />
              <circle className="scan-price-point" cx={xScale(selected)} cy={yScale(selected.indexLevel, priceRange)} r="5" />
              <circle className="scan-lots-point" cx={xScale(selected)} cy={yScale(selected[field], lotsRange)} r="5" />
            </g>}
          </svg>
        </div>
        {axisValues(priceRange, "scan-left-axis")}
        {axisValues(lotsRange, "scan-right-axis")}
        {selected && <div className="scan-chart-tooltip" role="tooltip" style={{ left: Math.max(70, Math.min(xScale(selected) - scrollOffset + 12, containerWidth - 210)) }}>
          <strong>{dashboard.formatTime(selected.time)}</strong>
          <div><span className="series-index">Index</span><b>{dashboard.formatValue(selected.indexLevel)}</b></div>
          <div><span className="series-lots">{metricLabel}</span><b>{field === "ratio" ? dashboard.formatValue(selected[field]) : dashboard.formatSignedValue(selected[field])}</b></div>
        </div>}
        {!points.length && <div className="scan-chart-empty">No snapshots in this window</div>}
      </div>
      <div className={"scan-chart-readout" + (selected ? " has-selection" : "")} aria-live="polite" aria-label="Selected chart sample">
        {selected ? <><strong>{dashboard.formatTime(selected.time)}</strong><span className="series-index">Index <b>{dashboard.formatValue(selected.indexLevel)}</b></span><span className="series-lots">{metricLabel} <b>{dashboard.formatSignedValue(selected[field])}</b></span></> : <span>{symbol} · {range.label} · 5-minute samples</span>}
        <span className="sr-only">{selectedLabel}</span>
      </div>
    </section>
  );
}
