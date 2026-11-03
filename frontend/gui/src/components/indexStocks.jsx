import React, { Fragment, useEffect, useRef, useState } from "react";
import "../indexStocks.css";
import StockHeatmap from "./stockHeatmap";
import { BUILDUP_NAMES, HEATMAP_INDEXES, clock, price, readStockIndex, readStockView, saveStockIndex, saveStockView, signedNumber, signedPct, tone, whole } from "../indexStocksData";

const LIVE_MS = 5000;
const CLOSED_MS = 60000;
const signedPrice = value => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${price(value)}` : "--";
const CHECK_TEXT = {
  Change: { bull: "Up from yesterday's close", bear: "Down from yesterday's close", flat: "Same as yesterday's close" },
  VWAP: { bull: "Above today's average price (VWAP)", bear: "Below today's average price (VWAP)", flat: "At today's average price (VWAP)" },
  Open: { bull: "Above today's open", bear: "Below today's open", flat: "At today's open" },
};
const BUILDUP_TEXT = {
  "Long Build-up": "Futures: price up and OI up, new buyers coming in",
  "Short Covering": "Futures: price up and OI down, sellers exiting",
  "Short Build-up": "Futures: price down and OI up, new sellers coming in",
  "Long Unwinding": "Futures: price down and OI down, buyers exiting",
};
const checkText = check => CHECK_TEXT[check.name]?.[check.side] || BUILDUP_TEXT[check.text] || check.text;

const CHARTS = [["gauge", "Gauge"], ["movers", "Movers"], ["sectors", "Sectors"]];
const CHART_KEY = "utraders-breadth-chart";
const readChart = () => { try { return CHARTS.some(([key]) => key === localStorage.getItem(CHART_KEY)) ? localStorage.getItem(CHART_KEY) : "gauge"; } catch { return "gauge"; } };
const saveChart = chart => { try { localStorage.setItem(CHART_KEY, chart); } catch { /* storage unavailable */ } };
const LIST_SIZE = 5;
const BAR_LIMIT = 10;

// Half-ring from left (0) to right (1); the up share fills from the left, then unchanged, then down.
function arc(from, to) {
  const point = share => {
    const angle = Math.PI * (1 - share);
    return `${(120 + 96 * Math.cos(angle)).toFixed(2)} ${(118 - 96 * Math.sin(angle)).toFixed(2)}`;
  };
  return `M ${point(from)} A 96 96 0 0 1 ${point(to)}`;
}

function Gauge({ breadth, stocks, onSelect }) {
  const total = breadth.up + breadth.down + breadth.flat || 1;
  const upShare = breadth.up / total;
  const flatShare = breadth.flat / total;
  const gainers = stocks.filter(stock => stock.changePct > 0).slice(0, LIST_SIZE);
  const losers = stocks.filter(stock => stock.changePct < 0).reverse().slice(0, LIST_SIZE);
  const list = (title, rows, side) => <div className={`ix-gauge-list is-${side}`}>
    <h3>{title}</h3>
    {rows.length ? <ol>{rows.map(stock => <li key={stock.symbol}>
      <button type="button" onClick={() => onSelect(stock.symbol)}><b>{stock.symbol}</b><span className={tone(stock.changePct)}>{signedPct(stock.changePct)}</span></button>
    </li>)}</ol> : <p className="ix-muted">None right now.</p>}
  </div>;
  return <div className="ix-gauge">
    <figure className="ix-gauge-dial">
      <svg viewBox="0 0 240 132" role="img" aria-label={`Advance and decline: ${breadth.up} of ${total} stocks up, ${breadth.down} down, ${breadth.flat} unchanged`}>
        <path className="ix-gauge-track" d={arc(0, 1)} />
        {breadth.up > 0 && <path className="ix-gauge-up" d={arc(0, upShare)} />}
        {breadth.flat > 0 && <path className="ix-gauge-flat" d={arc(upShare, upShare + flatShare)} />}
        {breadth.down > 0 && <path className="ix-gauge-down" d={arc(upShare + flatShare, 1)} />}
        <text className="ix-gauge-big" x="120" y="96" textAnchor="middle">{breadth.up} up</text>
        <text className="ix-gauge-small" x="120" y="118" textAnchor="middle">{breadth.down} down{breadth.flat ? ` · ${breadth.flat} flat` : ""}</text>
      </svg>
      <figcaption className="ix-muted">{Math.round(upShare * 100)}% of stocks are up</figcaption>
    </figure>
    {list("Top gainers", gainers, "up")}
    {list("Top losers", losers, "down")}
  </div>;
}

function BarRows({ rows, label, onSelect }) {
  const largest = Math.max(0.01, ...rows.map(row => Math.abs(row.value)));
  return <ol className="ix-bars">{rows.map(row => {
    const width = `${Math.abs(row.value) / largest * 50}%`;
    const content = <>
      <span className="ix-bar-name">{row.name}</span>
      <span className="ix-bar-track"><i className={row.value >= 0 ? "is-up" : "is-down"} style={row.value >= 0 ? { left: "50%", width } : { right: "50%", width }} /></span>
      <span className={`ix-bar-value ${tone(row.value)}`}>{signedPct(row.value)}</span>
      {row.note && <span className="ix-bar-note">{row.note}</span>}
    </>;
    return <li key={row.name}>{onSelect
      ? <button type="button" className="ix-bar" aria-label={`${row.name} ${signedPct(row.value)}, ${label}`} onClick={() => onSelect(row.name)}>{content}</button>
      : <div className="ix-bar">{content}</div>}</li>;
  })}</ol>;
}

function MoverBars({ stocks, onSelect }) {
  const [all, setAll] = useState(false);
  const trimmed = !all && stocks.length > BAR_LIMIT * 2;
  const shown = trimmed ? [...stocks.slice(0, BAR_LIMIT), ...stocks.slice(-BAR_LIMIT)] : stocks;
  return <>
    <BarRows rows={shown.map(stock => ({ name: stock.symbol, value: stock.changePct }))} label="open the stock" onSelect={onSelect} />
    {stocks.length > BAR_LIMIT * 2 && <button type="button" className="ix-more" onClick={() => setAll(value => !value)}>
      {all ? `Show top and bottom ${BAR_LIMIT}` : `Show all ${stocks.length} stocks`}</button>}
  </>;
}

function BreadthChart({ data, stocks, onSelect }) {
  const [chart, setChart] = useState(readChart);
  const choose = key => { setChart(key); saveChart(key); };
  const captions = {
    gauge: "How many stocks in the index are up or down. Tap a name to open the stock.",
    movers: "Each bar is one stock: right and green for gains, left and red for falls, longest bar is the biggest move. Tap a bar to open the stock.",
    sectors: "Each bar is a sector's average change, with how many of its stocks rose (↑) and fell (↓).",
  };
  return <section className="ix-card" aria-label="Market breadth">
    <header className="ix-panel-head">
      <h2>Market breadth</h2>
      {data.leading && <span>Leading <b>{data.leading.name}</b> <span className={tone(data.leading.avgChangePct)}>{signedPct(data.leading.avgChangePct)}</span>
        {" · "}Lagging <b>{data.lagging.name}</b> <span className={tone(data.lagging.avgChangePct)}>{signedPct(data.lagging.avgChangePct)}</span></span>}
      <div className="ix-tabs ix-chart-switch" role="group" aria-label="Chart style">
        {CHARTS.map(([key, label]) => <button key={key} type="button" aria-pressed={chart === key} className={chart === key ? "active" : ""} onClick={() => choose(key)}>{label}</button>)}
      </div>
    </header>
    <div className="ix-chart-body">
      {chart === "gauge" && <Gauge breadth={data.breadth} stocks={stocks} onSelect={onSelect} />}
      {chart === "movers" && <MoverBars stocks={stocks} onSelect={onSelect} />}
      {chart === "sectors" && <BarRows label="sector" rows={data.sectors.map(sector => ({ name: sector.name, value: sector.avgChangePct, note: `${sector.up}↑ ${sector.down}↓` }))} />}
    </div>
    <p className="ix-caption">{captions[chart]}</p>
  </section>;
}

function Align({ stock, side }) {
  const agree = side === "up" ? stock.bull : stock.bear;
  const total = stock.checks.length;
  return <span className={`ix-align is-${side}`} title={`${agree} of ${total} checks agree`} aria-label={`${agree} of ${total} checks agree`}>
    {[0, 1, 2, 3].map(slot => <i key={slot} className={slot < agree ? "is-on" : slot < total ? "" : "is-none"} />)}
  </span>;
}

function OiTag({ futures }) {
  if (!futures?.code) return <span className="ix-muted">--</span>;
  return <span className={`ix-oi is-${futures.code.toLowerCase()}`} title={BUILDUP_NAMES[futures.code]}>{futures.code}</span>;
}

function RangeBar({ stock }) {
  if (!Number.isFinite(stock.rangePos)) return <span className="ix-muted">--</span>;
  return <span className="ix-range" aria-label={`Price is ${Math.round(stock.rangePos * 100)}% of the way from today's low to high`}>
    <i style={{ left: `${stock.rangePos * 100}%` }} />
  </span>;
}

function StockDetail({ stock }) {
  const futures = stock.futures;
  const levels = stock.pivots;
  return <div className="ix-detail">
    <div>
      <h3>Today</h3>
      <dl>
        <dt>Open</dt><dd>{price(stock.open)}</dd><dt>High</dt><dd>{price(stock.high)}</dd>
        <dt>Low</dt><dd>{price(stock.low)}</dd><dt>Prev close</dt><dd>{price(stock.prevClose)}</dd>
        <dt>VWAP</dt><dd>{price(stock.vwap)}</dd><dt>Volume</dt><dd>{whole(stock.volume)}</dd>
      </dl>
      <div className="ix-detail-range"><span>Low</span><RangeBar stock={stock} /><span>High</span></div>
    </div>
    <div>
      <h3>Futures{futures ? ` · ${futures.symbol}` : ""}</h3>
      {futures ? <dl>
        <dt>Price</dt><dd>{price(futures.ltp)}</dd><dt>OI</dt><dd>{whole(futures.oi)}</dd>
        <dt>OI change</dt><dd className={tone(futures.oiChange)}>{signedNumber(futures.oiChange)} ({signedPct(futures.oiChangePct)})</dd>
        <dt>Build-up</dt><dd>{futures.buildup || "Waiting for yesterday's OI"}</dd>
      </dl> : <p className="ix-muted">This stock has no futures contract.</p>}
    </div>
    <div>
      <h3>Previous-day levels</h3>
      {levels ? <ol className="ix-levels">
        {[["S2", levels.s2], ["S1", levels.s1], ["Pivot", levels.p], ["R1", levels.r1], ["R2", levels.r2]].map(([name, value]) =>
          <li key={name} className={name.startsWith("S") ? "is-support" : name.startsWith("R") ? "is-resistance" : ""}><span>{name}</span><b>{price(value)}</b></li>)}
      </ol> : <p className="ix-muted">Levels load after the morning history update.</p>}
    </div>
    <div>
      <h3>Checks</h3>
      <ul className="ix-checks">{stock.checks.map(check =>
        <li key={check.name} className={`is-${check.side}`}><span aria-hidden="true">{check.side === "bull" ? "▲" : check.side === "bear" ? "▼" : "•"}</span>{checkText(check)}</li>)}
      </ul>
    </div>
  </div>;
}

function StockTable({ title, side, stocks, open, onToggle }) {
  return <section className={`ix-panel is-${side}`} aria-label={title}>
    <header className="ix-panel-head"><h2>{side === "up" ? "▲" : "▼"} {title}</h2><span>{stocks.length} stock{stocks.length === 1 ? "" : "s"}</span></header>
    {stocks.length === 0 ? <p className="ix-empty">No stocks {side === "up" ? "up" : "down"} right now.</p> :
      <div className="ix-scroll"><table className="ix-table">
        <thead><tr>
          <th scope="col">#</th><th scope="col">Symbol</th><th scope="col">Chg</th><th scope="col">LTP</th>
          <th scope="col" title="Futures OI build-up">OI</th><th scope="col" title="How many checks agree">Align</th><th scope="col">vs VWAP</th>
        </tr></thead>
        <tbody>{stocks.map((stock, position) => <Fragment key={stock.symbol}>
          <tr id={`ix-row-${stock.symbol}`} className={open === stock.symbol ? "is-open" : ""} onClick={() => onToggle(stock.symbol)}>
            <td className="ix-rank">{position + 1}</td>
            <th scope="row">
              <button type="button" aria-expanded={open === stock.symbol} onClick={event => { event.stopPropagation(); onToggle(stock.symbol); }}>{stock.symbol}</button>
              <small>{stock.sector}</small>
            </th>
            <td className={tone(stock.changePct)}>{signedPct(stock.changePct)}</td>
            <td>{price(stock.ltp)}</td>
            <td><OiTag futures={stock.futures} /></td>
            <td><Align stock={stock} side={side} /></td>
            <td className={tone(stock.vsVwapPct)}>{signedPct(stock.vsVwapPct)}</td>
          </tr>
          {open === stock.symbol && <tr className="ix-detail-row"><td colSpan="7"><StockDetail stock={stock} /></td></tr>}
        </Fragment>)}</tbody>
      </table></div>}
  </section>;
}

const VIEWS = [["details", "Details"], ["heatmap", "Heatmap"]];
const HEATMAP_ONLY = "nifty500";

function IndexStocks({ api }) {
  const [index, setIndex] = useState(readStockIndex);
  const [view, setView] = useState(readStockView);
  const [openRequest, setOpenRequest] = useState(null);
  const shownView = index === HEATMAP_ONLY ? "heatmap" : view;
  const chooseView = key => { setView(key); saveStockView(key); };
  const chooseIndex = key => {
    setIndex(key);
    saveStockIndex(key);
    setOpenRequest(null);
    if (key === HEATMAP_ONLY) chooseView("heatmap");
  };
  const openDetails = symbol => { chooseView("details"); setOpenRequest(symbol); };

  return <main className="ix-page">
    <header className="ix-head">
      <div>
        <h1>Index Stocks</h1>
        <span>Which stocks are moving NIFTY 50, BANK NIFTY, SENSEX and NIFTY 500, and by how much.</span>
      </div>
      <div className="ix-controls">
        <div className="ix-tabs" role="tablist" aria-label="Index">
          {HEATMAP_INDEXES.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={index === key}
            className={index === key ? "active" : ""} onClick={() => chooseIndex(key)}>{label}</button>)}
        </div>
        <div className="ix-tabs" role="group" aria-label="View">
          {VIEWS.map(([key, label]) => <button key={key} type="button" aria-pressed={shownView === key} className={shownView === key ? "active" : ""}
            disabled={key === "details" && index === HEATMAP_ONLY} title={key === "details" && index === HEATMAP_ONLY ? "Details are available for NIFTY 50, BANK NIFTY and SENSEX" : undefined}
            onClick={() => chooseView(key)}>{label}</button>)}
        </div>
      </div>
    </header>
    {shownView === "heatmap"
      ? <StockHeatmap api={api} index={index} onOpenDetails={index === HEATMAP_ONLY ? undefined : openDetails} />
      : <IndexDetails api={api} index={index} openRequest={openRequest} />}
  </main>;
}

function IndexDetails({ api, index, openRequest }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const delay = useRef(LIVE_MS);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    const abort = new AbortController();
    setData(null);
    setError("");
    setOpen(null);
    let first = true;
    const run = async () => {
      // Always load once; after that, skip refreshes while the page is hidden.
      if (first || document.visibilityState !== "hidden") {
        first = false;
        try {
          const next = await api.load(index, abort.signal);
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

  const toggle = symbol => setOpen(current => current === symbol ? null : symbol);
  const select = symbol => {
    setOpen(symbol);
    requestAnimationFrame(() => document.getElementById(`ix-row-${symbol}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
  };
  // A stock tapped in the heatmap opens here once its row has loaded.
  const pending = useRef(openRequest);
  useEffect(() => { pending.current = openRequest; }, [openRequest]);
  useEffect(() => {
    if (pending.current && data?.stocks?.some(stock => stock.symbol === pending.current)) {
      select(pending.current);
      pending.current = null;
    }
  }, [data]);  // eslint-disable-line react-hooks/exhaustive-deps

  const stocks = data?.stocks || [];
  const gainers = stocks.filter(stock => stock.changePct > 0);
  const losers = stocks.filter(stock => stock.changePct < 0).reverse();
  const unchanged = stocks.filter(stock => stock.changePct === 0);
  const breadth = data?.breadth;
  const spot = data?.spot || {};

  return <>
    {error && <p className="ix-error" role="alert">{error}</p>}
    {!data && !error && <p className="ix-loading" role="status">Loading stocks…</p>}

    {data && <>
      <div className="ix-status">
        <b>{data.label}</b>
        <span className="ix-spot">{price(spot.ltp)}</span>
        <span className={tone(spot.change)}>{signedPrice(spot.change)} ({signedPct(spot.changePct)})</span>
        <span className={`ix-live${data.marketOpen ? " is-live" : ""}`}>{data.marketOpen ? "Live" : "Market closed"}</span>
        {data.asOf && <span className="ix-muted">Updated {clock(data.asOf)} IST</span>}
      </div>
      {data.message && <p className="ix-note" role="status">{data.message}</p>}

      {stocks.length > 0 && <>
        <section className="ix-breadth" aria-label="Stocks up and down">
          <div className="ix-breadth-bar" role="img" aria-label={`${breadth.up} up, ${breadth.down} down, ${breadth.flat} unchanged`}>
            {breadth.up > 0 && <span className="is-up" style={{ flexGrow: breadth.up }}>{breadth.up} up</span>}
            {breadth.flat > 0 && <span className="is-flat" style={{ flexGrow: breadth.flat }}>{breadth.flat}</span>}
            {breadth.down > 0 && <span className="is-down" style={{ flexGrow: breadth.down }}>{breadth.down} down</span>}
          </div>
          <div className="ix-breadth-meta">
            <span className="is-up">▲ {breadth.bullish} bullish</span>
            <span className="is-down">▼ {breadth.bearish} bearish</span>
            <span className="ix-muted">· {breadth.choppy} choppy</span>
            <span className={`ix-mood is-${breadth.moodSide}`}>{breadth.mood}</span>
          </div>
        </section>

        <BreadthChart data={data} stocks={stocks} onSelect={select} />

        <div className="ix-grid">
          <StockTable title="Gainers" side="up" stocks={gainers} open={open} onToggle={toggle} />
          <StockTable title="Losers" side="down" stocks={losers} open={open} onToggle={toggle} />
        </div>
        {unchanged.length > 0 && <p className="ix-muted ix-unchanged">No change: {unchanged.map(stock => stock.symbol).join(", ")}</p>}
        {data.missing?.length > 0 && <p className="ix-muted ix-unchanged">No live price yet: {data.missing.join(", ")}</p>}
      </>}

      <footer className="ix-notes">
        <p><b>How to read this.</b> A stock is <b>bullish</b> when at least 3 of these point up: price up from yesterday, above today's
          average price (VWAP), above today's open, and futures showing long build-up or short covering. <b>Bearish</b> is the same
          pointing down. <b>Choppy</b> means they disagree. <b>Align</b> shows how many checks agree. S1/R1 are levels worked out from
          the previous day's high, low and close.</p>
        {stocks.length > 0 && data.levelsReady < stocks.length &&
          <p className="ix-muted">Previous-day levels and OI build-up are ready for {data.levelsReady} of {stocks.length} stocks; the rest load during the morning.</p>}
        <p className="ix-muted">Utraders describes the market. It does not tell you to buy or sell.</p>
      </footer>
    </>}
  </>;
}

// Live index prices re-render the app every second; this page only changes with its own props.
export default React.memo(IndexStocks);
