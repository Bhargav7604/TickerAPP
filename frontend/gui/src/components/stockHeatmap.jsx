import React, { useEffect, useRef, useState } from "react";
import useWidth from "../useWidth";
import { clock, price, rupeesCompact, signedPct, tone } from "../indexStocksData";

const LIVE_MS = 8000;
const CLOSED_MS = 60000;
const HEADER = 18;
const SIZES = [["value", "Money traded"], ["equal", "Equal"]];

/** Squarified treemap (Bruls, Huizing & van Wijk): lays items out in rows that keep boxes close to square. */
export function squarify(items, rect) {
  const total = items.reduce((sum, item) => sum + item.size, 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return [];
  const scale = rect.w * rect.h / total;
  const nodes = items.map(item => ({ item, area: item.size * scale }));
  let { x, y, w, h } = rect;
  const placed = [];
  const worst = (row, side) => {
    const sum = row.reduce((total, node) => total + node.area, 0);
    const largest = Math.max(...row.map(node => node.area));
    const smallest = Math.min(...row.map(node => node.area));
    return Math.max(side * side * largest / (sum * sum), sum * sum / (side * side * smallest));
  };
  const lay = row => {
    const sum = row.reduce((total, node) => total + node.area, 0);
    if (w >= h) {
      const width = Math.min(w, sum / h);
      let top = y;
      row.forEach(node => { const height = node.area / width; placed.push({ ...node.item, x, y: top, w: width, h: height }); top += height; });
      x += width; w -= width;
    } else {
      const height = Math.min(h, sum / w);
      let left = x;
      row.forEach(node => { const width = node.area / height; placed.push({ ...node.item, x: left, y, w: width, h: height }); left += width; });
      y += height; h -= height;
    }
  };
  let row = [];
  for (let index = 0; index < nodes.length;) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, nodes[index]], side) <= worst(row, side)) {
      row.push(nodes[index]);
      index += 1;
    } else {
      lay(row);
      row = [];
    }
  }
  if (row.length) lay(row);
  return placed;
}

const NEUTRAL = [38, 46, 62];
const UP = [[31, 122, 85], [95, 227, 166]];
const DOWN = [[138, 47, 69], [226, 71, 94]];
const mix = (from, to, amount) => from.map((value, index) => Math.round(value + (to[index] - value) * amount));

/** Dark neutral near 0%, deeper green or red as the move grows; full colour at ±3%. */
export function heatColor(pct) {
  const size = Math.min(Math.abs(pct || 0), 3);
  const [mid, end] = pct >= 0 ? UP : DOWN;
  const rgb = size <= 1 ? mix(NEUTRAL, mid, size) : mix(mid, end, (size - 1) / 2);
  const light = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.6;
  return { background: `rgb(${rgb.join(",")})`, color: light ? "#06281b" : "#f1f5f9" };
}

function layout(data, width, height, sizeBy) {
  const sizeOf = tile => sizeBy === "equal" ? 1 : tile.value;
  const total = data.tiles.reduce((sum, tile) => sum + sizeOf(tile), 0) || 1;
  const floor = total / (data.tiles.length * 25);  // stocks that have not traded yet stay visible
  const bySector = new Map(data.sectors.map(sector => [sector.name, []]));
  data.tiles.forEach(tile => bySector.get(tile.sector)?.push({ ...tile, size: Math.max(sizeOf(tile), floor) }));
  const sectors = data.sectors.map(sector => {
    const tiles = (bySector.get(sector.name) || []).sort((a, b) => b.size - a.size);
    return { ...sector, tiles, size: tiles.reduce((sum, tile) => sum + tile.size, 0) };
  }).filter(sector => sector.size > 0).sort((a, b) => b.size - a.size);
  return squarify(sectors, { x: 0, y: 0, w: width, h: height }).map(sector => {
    const labelled = sector.h > HEADER * 2.2 && sector.w > 70;
    const inner = { x: sector.x + 1, y: sector.y + (labelled ? HEADER : 1), w: sector.w - 2, h: sector.h - (labelled ? HEADER + 1 : 2) };
    return { ...sector, labelled, tiles: squarify(sector.tiles, inner) };
  });
}

function TileLabel({ tile }) {
  if (tile.w < 40 || tile.h < 22) return null;
  const size = Math.max(10, Math.min(16, Math.min(tile.w / 6, tile.h / 3)));
  return <span className="hm-label" style={{ fontSize: size }}>
    <b>{tile.symbol}</b>
    {tile.h >= 34 && <span>{signedPct(tile.changePct)}</span>}
  </span>;
}

export default function StockHeatmap({ api, index, onOpenDetails }) {
  const box = useRef(null);
  const width = useWidth(box, 960);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [sizeBy, setSizeBy] = useState("value");
  const [focus, setFocus] = useState(null);
  const [pinned, setPinned] = useState(null);
  const delay = useRef(LIVE_MS);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    const abort = new AbortController();
    setData(null);
    setError("");
    setPinned(null);
    let first = true;
    const run = async () => {
      // Always load once; after that, skip refreshes while the page is hidden.
      if (first || document.visibilityState !== "hidden") {
        first = false;
        try {
          const next = await api.heatmap(index, abort.signal);
          if (stopped) return;
          setData(next);
          setError("");
          delay.current = next.retryAfterMs ? Math.max(1000, next.retryAfterMs) : next.marketOpen ? LIVE_MS : CLOSED_MS;
        } catch (exc) {
          if (stopped) return;
          setError(exc.message);
          delay.current = LIVE_MS * 2;
        }
      }
      if (!stopped) timer = setTimeout(run, delay.current);
    };
    run();
    return () => { stopped = true; abort.abort(); clearTimeout(timer); };
  }, [api, index]);

  const height = width < 700 ? Math.round(width * 1.45) : Math.round(Math.min(900, Math.max(480, width * (index === "nifty500" ? 0.72 : 0.6))));
  const sectors = data?.tiles?.length ? layout(data, width, height, sizeBy) : [];
  const shown = data?.tiles?.find(tile => tile.symbol === (focus || pinned));
  const breadth = data?.breadth;

  return <section className="hm" aria-label="Heatmap" ref={box}>
    {error && <p className="ix-error" role="alert">{error}</p>}
    {!data && !error && <p className="ix-loading" role="status">Loading heatmap…</p>}
    {data && <>
      <div className="ix-status">
        <b>{data.label}</b>
        <span className="ix-spot">{price(data.spot?.ltp)}</span>
        <span className={tone(data.spot?.changePct)}>{signedPct(data.spot?.changePct)}</span>
        {breadth && <span><span className="is-up">{breadth.up} up</span> · <span className="is-down">{breadth.down} down</span></span>}
        {breadth && <span className={`ix-mood is-${breadth.moodSide}`}>{breadth.mood}</span>}
        <span className={`ix-live${data.marketOpen ? " is-live" : ""}`}>{data.marketOpen ? "Live" : "Market closed"}</span>
        {data.asOf && <span className="ix-muted">Updated {clock(data.asOf)} IST</span>}
      </div>
      {data.message && <p className="ix-note" role="status">{data.message}</p>}
      <div className="hm-bar">
        <div className="hm-info" aria-live="polite">
          {shown ? <>
            <b>{shown.symbol}</b> <span className="ix-muted">{shown.company} · {shown.sector}</span>
            <span>{price(shown.ltp)}</span><span className={tone(shown.changePct)}>{signedPct(shown.changePct)}</span>
            <span className="ix-muted">{rupeesCompact(shown.value)} traded</span>
            {pinned === shown.symbol && onOpenDetails && <button type="button" className="hm-open" onClick={() => onOpenDetails(shown.symbol)}>Open details</button>}
          </> : <span className="ix-muted">Point at or tap a box to see the stock. Box size: {sizeBy === "equal" ? "every stock the same" : "money traded today"}.</span>}
        </div>
        <div className="ix-tabs hm-size" role="group" aria-label="Box size">
          {SIZES.map(([key, label]) => <button key={key} type="button" aria-pressed={sizeBy === key} className={sizeBy === key ? "active" : ""} onClick={() => setSizeBy(key)}>{label}</button>)}
        </div>
      </div>
      <div className="hm-map" style={{ height }} onMouseLeave={() => setFocus(null)}
        role="img" aria-label={breadth ? `${data.label} heatmap: ${breadth.up} stocks up, ${breadth.down} down` : `${data.label} heatmap`}>
        {sectors.map(sector => <div key={sector.name} className="hm-sector"
          style={{ left: sector.x, top: sector.y, width: sector.w, height: sector.h }}>
          {sector.labelled && <span className="hm-sector-name" title={`${sector.name}: ${signedPct(sector.avgChangePct)} average, ${sector.up} up, ${sector.down} down`}>
            {sector.name} <i className={tone(sector.avgChangePct)}>{signedPct(sector.avgChangePct)}</i>
          </span>}
          {sector.tiles.map(tile => <div key={tile.symbol} className={`hm-tile${pinned === tile.symbol ? " is-pinned" : ""}`}
            style={{ left: tile.x - sector.x, top: tile.y - sector.y, width: Math.max(0, tile.w - 1), height: Math.max(0, tile.h - 1), ...heatColor(tile.changePct) }}
            title={`${tile.symbol} ${signedPct(tile.changePct)}`} onMouseEnter={() => setFocus(tile.symbol)}
            onClick={() => setPinned(current => current === tile.symbol ? null : tile.symbol)}>
            <TileLabel tile={tile} />
          </div>)}
        </div>)}
      </div>
      <div className="hm-legend" aria-hidden="true">
        {[-3, -2, -1, 0, 1, 2, 3].map(value => <span key={value} style={heatColor(value)}>{value > 0 ? "+" : ""}{value}%</span>)}
      </div>
      {data.missing?.length > 0 && <p className="ix-muted ix-unchanged">No live price yet: {data.missing.length} stock{data.missing.length === 1 ? "" : "s"}</p>}
    </>}
  </section>;
}
