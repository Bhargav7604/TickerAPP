import React, { Fragment, useEffect, useRef, useState } from "react";
import "../indexStocks.css";
import { BUILDUP_NAMES, STOCK_INDEXES, clock, price, readStockIndex, saveStockIndex, signedNumber, signedPct, tone, whole } from "../indexStocksData";

const LIVE_MS = 5000;
const CLOSED_MS = 60000;
const TOP = 3;
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

function useWidth(ref, fallback = 800) {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

// Spreads dots that share a score so they don't sit on one line; stable per symbol.
const jitter = symbol => {
  let hash = 0;
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) % 997;
  return hash / 997 - 0.5;
};

function XRay({ stocks, breadth, selected, onSelect }) {
  const box = useRef(null);
  const width = useWidth(box);
  const height = 250;
  const pad = { left: 14, right: 14, top: 14, bottom: 30 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const limit = Math.ceil(Math.max(0.5, ...stocks.map(stock => Math.abs(stock.changePct))) * 2) / 2;
  const step = limit <= 2 ? 0.5 : limit <= 5 ? 1 : 2;
  const x = value => pad.left + (value + limit) / (2 * limit) * plotWidth;
  const y = value => pad.top + (5 - value) / 10 * plotHeight;
  const ticks = [];
  for (let tick = -limit; tick <= limit + 1e-9; tick += step) ticks.push(Number(tick.toFixed(1)));
  const marked = new Set([...stocks.slice(0, TOP), ...stocks.slice(-TOP)].map(stock => stock.symbol));
  return <div className="ix-xray" ref={box}>
    <svg width={width} height={height} role="img"
      aria-label={`${breadth.bullish} bullish, ${breadth.bearish} bearish and ${breadth.choppy} choppy stocks, placed by change from yesterday`}>
      <rect className="ix-band is-bull" x={pad.left} y={pad.top} width={plotWidth} height={y(2) - pad.top} />
      <rect className="ix-band is-bear" x={pad.left} y={y(-2)} width={plotWidth} height={pad.top + plotHeight - y(-2)} />
      {ticks.map(tick => <g key={tick}>
        <line className={tick === 0 ? "ix-zero" : "ix-gridline"} x1={x(tick)} x2={x(tick)} y1={pad.top} y2={pad.top + plotHeight} />
        <text className="ix-tick" x={x(tick)} y={height - 10} textAnchor="middle">{tick > 0 ? "+" : ""}{tick}%</text>
      </g>)}
      <text className="ix-band-label is-bull" x={pad.left + 8} y={pad.top + 16}>▲ {breadth.bullish} bullish</text>
      <text className="ix-band-label is-bear" x={width - pad.right - 8} y={pad.top + plotHeight - 8} textAnchor="end">▼ {breadth.bearish} bearish</text>
      {stocks.map(stock => {
        const cx = x(stock.changePct);
        // Within one agreement score, stocks nearer today's high sit higher.
        const lift = Number.isFinite(stock.rangePos) ? (stock.rangePos - 0.5) * 1.4 : 0;
        const cy = y(Math.max(-4.9, Math.min(4.9, stock.score + lift + jitter(stock.symbol) * 0.3)));
        return <g key={stock.symbol} className={`ix-dot is-${stock.state}${selected === stock.symbol ? " is-selected" : ""}`}
          onClick={() => onSelect(stock.symbol)}>
          {(marked.has(stock.symbol) || selected === stock.symbol) && <circle className="ix-ring" cx={cx} cy={cy} r="9" />}
          <circle cx={cx} cy={cy} r="5"><title>{`${stock.symbol} ${signedPct(stock.changePct)}, ${stock.state}`}</title></circle>
        </g>;
      })}
    </svg>
  </div>;
}

function Mover({ stock, place, side, onSelect }) {
  const levels = stock.pivots ? [["S1", stock.pivots.s1], ["R1", stock.pivots.r1]] : [["Low", stock.low], ["High", stock.high]];
  return <button type="button" className={`ix-mover is-${side}`} onClick={() => onSelect(stock.symbol)}>
    <span className="ix-mover-head"><b>{stock.symbol}</b><span className={tone(stock.changePct)}>{signedPct(stock.changePct)}</span></span>
    <span className="ix-mover-tag">{side === "up" ? "Top gainer" : "Top loser"} #{place}</span>
    <span className="ix-mover-grid">
      <span>LTP</span><b>{price(stock.ltp)}</b>
      <span>vs VWAP</span><b className={tone(stock.vsVwapPct)}>{signedPct(stock.vsVwapPct)}</b>
      {levels.map(([name, value]) => <Fragment key={name}><span>{name}</span><b>{price(value)}</b></Fragment>)}
    </span>
    <span className="ix-mover-foot"><Align stock={stock} side={side} /><span>{stock.sector}</span></span>
  </button>;
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

function SectorFlow({ sectors }) {
  return <section className="ix-panel ix-sectors" aria-label="Sector flow">
    <header className="ix-panel-head"><h2>Sector flow</h2><span>by average change</span></header>
    <ul>{sectors.map(sector => <li key={sector.name}>
      <div className="ix-sector-head">
        <b>{sector.name}</b>
        <span className={tone(sector.avgChangePct)}>{signedPct(sector.avgChangePct)}</span>
        <small>{sector.up}↑ {sector.down}↓</small>
      </div>
      <div className="ix-squares">
        {sector.stocks.map(stock => <span key={stock.symbol} className={`ix-square ${tone(stock.changePct)}`} title={`${stock.symbol} ${signedPct(stock.changePct)}`} />)}
        <span className="sr-only">{sector.stocks.map(stock => `${stock.symbol} ${signedPct(stock.changePct)}`).join(", ")}</span>
      </div>
    </li>)}</ul>
  </section>;
}

export default function IndexStocks({ api }) {
  const [index, setIndex] = useState(readStockIndex);
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
    const run = async () => {
      if (document.visibilityState !== "hidden") {
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

  const chooseIndex = key => { setIndex(key); saveStockIndex(key); };
  const toggle = symbol => setOpen(current => current === symbol ? null : symbol);
  const select = symbol => {
    setOpen(symbol);
    requestAnimationFrame(() => document.getElementById(`ix-row-${symbol}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" }));
  };

  const stocks = data?.stocks || [];
  const gainers = stocks.filter(stock => stock.changePct > 0);
  const losers = stocks.filter(stock => stock.changePct < 0).reverse();
  const unchanged = stocks.filter(stock => stock.changePct === 0);
  const breadth = data?.breadth;
  const spot = data?.spot || {};

  return <main className="ix-page">
    <header className="ix-head">
      <div>
        <h1>Index Stocks</h1>
        <span>Which stocks are moving NIFTY 50, BANK NIFTY and SENSEX, and by how much.</span>
      </div>
      <div className="ix-tabs" role="tablist" aria-label="Index">
        {STOCK_INDEXES.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={index === key}
          className={index === key ? "active" : ""} onClick={() => chooseIndex(key)}>{label}</button>)}
      </div>
    </header>

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
        <section className="ix-breadth" aria-label="Market breadth">
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

        <section className="ix-card" aria-label="Market X-ray">
          <header className="ix-panel-head">
            <h2>Market X-ray</h2>
            {data.leading && <span>Leading <b>{data.leading.name}</b> <span className={tone(data.leading.avgChangePct)}>{signedPct(data.leading.avgChangePct)}</span>
              {" · "}Lagging <b>{data.lagging.name}</b> <span className={tone(data.lagging.avgChangePct)}>{signedPct(data.lagging.avgChangePct)}</span></span>}
          </header>
          <XRay stocks={stocks} breadth={breadth} selected={open} onSelect={select} />
          <p className="ix-caption">Each dot is one stock. Left to right: change from yesterday. Higher dots have more checks pointing up and sit nearer today's high. Tap a dot to open the stock.</p>
        </section>

        <section className="ix-movers" aria-label="Top movers">
          {gainers.slice(0, TOP).map((stock, position) => <Mover key={stock.symbol} stock={stock} place={position + 1} side="up" onSelect={select} />)}
          {losers.slice(0, TOP).map((stock, position) => <Mover key={stock.symbol} stock={stock} place={position + 1} side="down" onSelect={select} />)}
        </section>

        <div className="ix-grid">
          <StockTable title="Gainers" side="up" stocks={gainers} open={open} onToggle={toggle} />
          <StockTable title="Losers" side="down" stocks={losers} open={open} onToggle={toggle} />
          <SectorFlow sectors={data.sectors} />
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
  </main>;
}
