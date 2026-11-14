import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import OiTrendChart from "./oiTrendChart";
import OiStrikeBars from "./oiStrikeBars";
import StockFno from "./stockFno";
import "../oiAnalysis.css";
import {
  BUILDUP_SHORT, compactOi, formatPct, formatPrice, formatRatio, formatSignedOi, formatSignedPrice,
  OI_CHANGE_WINDOWS, OI_INDEXES, readChangeWindow, readStrikeRange, saveChangeWindow, saveStrikeRange, shortOi, signClass, signedShortOi,
  STRIKE_RANGES, timeLabel,
} from "../oiData";

const TREND_REFRESH_MS = 30000;
const LIVE_REFRESH_MS = 3000;
const TABS = [["trend", "OI Trend"], ["chain", "Option Chain"], ["stocks", "Stock F&O"]];

function Stat({ label, value, tone, note, noteTone }) {
  return <div className="oi-stat"><span>{label}</span><strong className={tone || ""}>{value}</strong>
    {note && <small className={noteTone || ""}>{note}</small>}</div>;
}

function BuildupTag({ value }) {
  if (!value) return <span className="oi-muted">--</span>;
  return <span className={`oi-buildup oi-buildup-${BUILDUP_SHORT[value].toLowerCase()}`} title={value}>{BUILDUP_SHORT[value]}</span>;
}

function TrendTable({ rows }) {
  return <div className="oi-table-scroll"><table className="oi-table">
    <caption className="sr-only">Trending OI by time</caption>
    <thead><tr>
      <th scope="col">Time</th><th scope="col">Index</th><th scope="col">Day H/L break</th>
      <th scope="col">Call OI chg</th><th scope="col">Put OI chg</th><th scope="col">Put − Call</th><th scope="col">Strength</th>
      <th scope="col">Diff chg</th><th scope="col">Change PCR</th><th scope="col">Call LTP</th><th scope="col">Put LTP</th><th scope="col">Sentiment</th>
    </tr></thead>
    <tbody>{rows.map(row => <tr key={row.time}>
      <th scope="row">{timeLabel(row.time)}</th>
      <td>{formatPrice(row.underlying)}</td>
      <td>{row.dayBreak ? <span className={`oi-break oi-break-${row.dayBreak.type.toLowerCase()}`}>{row.dayBreak.type} {formatPrice(row.dayBreak.level)}</span> : <span className="oi-muted">--</span>}</td>
      <td>{formatSignedOi(row.callOiChange)}</td>
      <td>{formatSignedOi(row.putOiChange)}</td>
      <td className={signClass(row.diff)}>{formatSignedOi(row.diff)}</td>
      <td><span className={`oi-strength ${signClass(row.strength)}`}>{formatPct(row.strength)}</span></td>
      <td className={signClass(row.diffChange)}>{row.diffChange === undefined ? "--" : formatSignedOi(row.diffChange)}</td>
      <td>{formatRatio(row.changePcr)}</td>
      <td>{formatPrice(row.callLtp)}{row.callLtpChange !== undefined && <small className={signClass(row.callLtpChange)}> {formatSignedPrice(row.callLtpChange)}</small>}</td>
      <td>{formatPrice(row.putLtp)}{row.putLtpChange !== undefined && <small className={signClass(row.putLtpChange)}> {formatSignedPrice(row.putLtpChange)}</small>}</td>
      <td><span className={`oi-sentiment oi-sentiment-${row.sentiment.toLowerCase()}`}>{row.sentiment}</span></td>
    </tr>)}</tbody>
  </table></div>;
}

const FLASH_FIELDS = ["ltp", "oi"];

export function chainFlashes(previous, next) {
  const before = new Map();
  previous?.rows?.forEach(row => ["call", "put"].forEach(side => FLASH_FIELDS.forEach(field => before.set(`${row.strike}:${side}:${field}`, row[side]?.[field]))));
  const flashes = {};
  next.rows.forEach(row => ["call", "put"].forEach(side => FLASH_FIELDS.forEach(field => {
    const key = `${row.strike}:${side}:${field}`;
    const a = before.get(key), b = row[side]?.[field];
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) flashes[key] = b > a ? "up" : "down";
  })));
  return flashes;
}

// Calls read outward-in to the strike; puts mirror them.
const CALL_COLUMNS = ["buildupWindow", "oiChangeWindow", "oi", "oiChange", "volume", "iv", "ltp", "delta"];
const PUT_COLUMNS = [...CALL_COLUMNS].reverse();
const windowLabel = minutes => OI_CHANGE_WINDOWS.find(([value]) => value === minutes)?.[1] || `${minutes}m`;
const fixed = (value, places) => Number.isFinite(value) ? value.toFixed(places) : "--";
const clockLabel = seconds => new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" });

function ChainTable({ data, flashes = {} }) {
  const scroller = useRef(null);
  const centred = useRef("");
  // Open each expiry and strike range on the ATM strike; the 3-second refreshes leave the trader's scroll alone.
  useEffect(() => {
    const box = scroller.current;
    const atmRow = box?.querySelector("tr.is-atm");
    const key = `${data.expiry}|${data.range}`;
    if (!atmRow || centred.current === key) return;
    centred.current = key;
    const head = box.querySelector("thead")?.offsetHeight || 0;
    const offset = atmRow.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTop += offset - head - (box.clientHeight - head - atmRow.offsetHeight) / 2;
  });
  const tf = windowLabel(data.window);
  const labels = { buildupWindow: `Build-up ${tf}`, oiChangeWindow: `ΔOI ${tf}`, oi: "OI", oiChange: "ΔOI day", volume: "Vol", iv: "IV", ltp: "LTP", delta: "Δ" };
  const titles = {
    buildupWindow: `Build-up over the last ${tf}: OI and premium against the recording then`,
    oiChangeWindow: `OI change over the last ${tf}`, oiChange: "OI change since the previous session's close",
    volume: "Contracts traded today", iv: "Implied volatility, %", delta: "Premium move for a one-point move in the index",
  };
  const maxOi = { call: Math.max(1, ...data.rows.map(row => row.call?.oi || 0)), put: Math.max(1, ...data.rows.map(row => row.put?.oi || 0)) };
  const cell = (row, side, column) => {
    const value = row[side];
    const raw = value?.[column];
    const flash = flashes[`${row.strike}:${side}:${column}`];
    const tick = flash ? ` oi-tick-${flash}` : "";
    if (column === "buildupWindow") return <td key={column}><BuildupTag value={raw} /></td>;
    if (column === "oiChangeWindow" || column === "oiChange") return <td key={column} className={`${signClass(raw)}${column === "oiChangeWindow" ? " oi-window" : ""}`}>{formatSignedOi(raw)}</td>;
    if (column === "oi") {
      // A bar behind the number, growing from the strike outwards, sized against the biggest OI on that side.
      const share = Number.isFinite(raw) ? Math.round(raw / maxOi[side] * 100) : 0;
      return <td key={column} className={`oi-oi oi-oi-${side}${tick}`} style={{ "--oi-bar": `${share}%` }}>{shortOi(raw)}</td>;
    }
    if (column === "volume") return <td key={column}>{shortOi(raw)}</td>;
    if (column === "iv") return <td key={column}>{fixed(raw, 1)}</td>;
    if (column === "delta") return <td key={column} className="oi-delta">{fixed(raw, 2)}</td>;
    return <td key={column} className={tick.trim() || undefined}>{formatPrice(raw)}</td>;
  };
  const spotAfter = Number.isFinite(data.underlying) ? data.rows.filter(row => row.strike <= data.underlying).length : -1;
  const spotRow = <tr key="spot" className="oi-spot-row"><td colSpan={CALL_COLUMNS.length * 2 + 1}>Spot {formatPrice(data.underlying)}</td></tr>;
  return <div className="oi-table-scroll oi-chain-scroll" ref={scroller}><table className="oi-table oi-chain">
    <caption className="sr-only">Option chain with OI build-up</caption>
    <thead>
      <tr><th colSpan={CALL_COLUMNS.length} className="oi-side-call">Calls</th><th rowSpan="2" className="oi-strike-head">Strike</th><th colSpan={PUT_COLUMNS.length} className="oi-side-put">Puts</th></tr>
      <tr>{CALL_COLUMNS.map(column => <th key={`c-${column}`} scope="col" title={titles[column]}>{labels[column]}</th>)}
        {PUT_COLUMNS.map(column => <th key={`p-${column}`} scope="col" title={titles[column]}>{labels[column]}</th>)}</tr>
    </thead>
    <tbody>{data.rows.flatMap((row, position) => {
      const itmCall = data.underlying && row.strike < data.underlying;
      const itmPut = data.underlying && row.strike > data.underlying;
      const line = <tr key={row.strike} className={`${row.strike === data.atm ? "is-atm" : ""} ${itmCall ? "itm-call" : ""} ${itmPut ? "itm-put" : ""}`}>
        {CALL_COLUMNS.map(column => cell(row, "call", column))}
        <th scope="row" className="oi-strike">{row.strike.toLocaleString("en-IN")}{row.strike === data.atm && <small>ATM</small>}</th>
        {PUT_COLUMNS.map(column => cell(row, "put", column))}
      </tr>;
      return position === spotAfter ? [spotRow, line] : [line];
    }).concat(spotAfter === data.rows.length ? [spotRow] : [])}</tbody>
  </table></div>;
}

function ChainSummary({ chain, indexLabel }) {
  const tf = windowLabel(chain.window);
  const totals = chain.totals || {};
  const windowTotals = chain.windowTotals;
  return <section className="oi-stats oi-chain-stats" aria-label="Option chain summary">
    <Stat label="Spot" value={formatPrice(chain.underlying)} tone="oi-spot-value" />
    <Stat label="ATM" value={chain.atm?.toLocaleString("en-IN") ?? "--"} />
    <Stat label="Expiry" value={chain.expiry ? new Date(chain.expiry + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "--"} />
    <Stat label="PCR (OI)" value={formatRatio(totals.pcr)} tone={totals.pcr >= 1 ? "oi-up" : totals.pcr ? "oi-down" : ""} />
    <Stat label="Max pain" value={chain.maxPain?.toLocaleString("en-IN") ?? "--"} />
    <Stat label="ATM IV" value={Number.isFinite(chain.atmIv) ? `${chain.atmIv}%` : "--"} />
    <Stat label="CE OI" value={shortOi(totals.callOi)} note={`ΔDay ${signedShortOi(totals.callOiChange)}`} noteTone={signClass(-(totals.callOiChange || 0))} />
    <Stat label="PE OI" value={shortOi(totals.putOi)} note={`ΔDay ${signedShortOi(totals.putOiChange)}`} noteTone={signClass(totals.putOiChange)} />
    <Stat label={`ΔOI ${tf} CE / PE`} value={windowTotals ? `${signedShortOi(windowTotals.callOiChange)} / ${signedShortOi(windowTotals.putOiChange)}` : "warming"} />
    <span className="sr-only">{indexLabel} option chain</span>
  </section>;
}

function OiAnalysis({ api, boardApi }) {
  const [index, setIndex] = useState("nifty");
  const [tab, setTab] = useState("trend");
  const [meta, setMeta] = useState({ expiries: [], recorded: [], intervals: [3, 6, 15, 30, 60], strikeWindows: [5, 7, 10, 15] });
  const [expiry, setExpiry] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(3);
  const [strikes, setStrikes] = useState(7);
  const [changeWindow, setChangeWindow] = useState(readChangeWindow);
  const [strikeRange, setStrikeRange] = useState(readStrikeRange);
  const [trend, setTrend] = useState(null);
  const [chain, setChain] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState(null);
  const [live, setLive] = useState(false);
  const [flashes, setFlashes] = useState({});
  const controller = useRef(null);
  const nextDelay = useRef(TREND_REFRESH_MS);
  const chainRef = useRef(null);

  useEffect(() => {
    const abort = new AbortController();
    setExpiry("");
    setTrend(null);
    setChain(null);
    api.expiries(index, abort.signal).then(result => {
      setMeta(result);
      setExpiry(result.recorded[0] || result.expiries[0] || "");
      setError(result.expiries.length ? "" : "No upcoming expiries found for this index.");
    }).catch(exc => { if (!abort.signal.aborted) setError(exc.message); });
    return () => abort.abort();
  }, [api, index]);

  const load = useCallback(async () => {
    if (!expiry || tab === "stocks") return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    nextDelay.current = TREND_REFRESH_MS;
    try {
      if (tab === "trend") {
        setTrend(await api.trend(index, expiry, intervalMinutes, strikes, abort.signal));
      } else {
        let next = await api.liveChain(index, expiry, changeWindow, strikeRange, abort.signal).catch(exc => ({ live: false, message: exc.message }));
        const isLive = Boolean(next.live && next.rows?.length);
        if (isLive) nextDelay.current = next.retryAfterMs || LIVE_REFRESH_MS;
        else if (next.live) nextDelay.current = next.retryAfterMs || 1000;
        else next = { ...(await api.chain(index, expiry, changeWindow, strikeRange, abort.signal)), liveMessage: next.message };
        if (abort.signal.aborted) return;
        if (next.rows?.length) {
          setFlashes(chainFlashes(chainRef.current, next));
          chainRef.current = next;
        }
        setLive(isLive);
        if (next.rows?.length || !chainRef.current) setChain(next);
      }
      setError("");
      setRefreshedAt(Date.now());
    } catch (exc) {
      if (!abort.signal.aborted) setError(exc.message);
    } finally {
      if (controller.current === abort) setLoading(false);
    }
  }, [api, index, expiry, tab, intervalMinutes, strikes, changeWindow, strikeRange]);

  useEffect(() => {
    let timer;
    let stopped = false;
    const run = async () => {
      if (document.visibilityState === "visible") await load();
      if (!stopped) timer = setTimeout(run, nextDelay.current);
    };
    chainRef.current = null;
    run();
    return () => { stopped = true; clearTimeout(timer); controller.current?.abort(); };
  }, [load]);

  useEffect(() => {
    if (!Object.keys(flashes).length) return undefined;
    const timer = setTimeout(() => setFlashes({}), 900);
    return () => clearTimeout(timer);
  }, [flashes]);

  const data = tab === "trend" ? trend : tab === "chain" ? chain : null;
  const latest = trend?.rows?.[0];
  const indexLabel = OI_INDEXES.find(([key]) => key === index)[1];

  const status = tab === "chain" && chain?.bucketTime
    ? `chain @${clockLabel(chain.bucketTime)} · ${live && chain.marketOpen ? "live quotes every 3 sec" : live ? "closed — last print" : "last recording"}`
    : `${indexLabel} options · ${refreshedAt ? `updated ${clockLabel(refreshedAt / 1000)} IST` : "loading"} · refreshes every 30 sec`;

  return <main className="oi-page">
    <header className="oi-command">
      <div className="oi-title">
        <h1>{tab === "chain" ? "Option chain" : tab === "stocks" ? "Stock F&O" : "OI Analysis"}</h1>
        <span>{tab === "chain" && live && chain?.marketOpen && <b className="oi-live-badge">LIVE</b>}{tab === "stocks" ? "stock futures build-up · refreshes every 5 sec" : status}</span>
      </div>
      {tab !== "stocks" && <div className="oi-controls">
        <label>Symbol
          <select value={index} onChange={event => setIndex(event.target.value)} aria-label="Symbol">
            {OI_INDEXES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label>Expiry
          <select value={expiry} onChange={event => setExpiry(event.target.value)} aria-label="Expiry">
            {meta.expiries.map((value, position) => <option key={value} value={value}>{position === 0 ? "nearest · " : ""}{new Date(value + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}{meta.recorded.includes(value) ? "" : " (no data yet)"}</option>)}
          </select>
        </label>
        {tab === "trend" && <>
          <label>Interval
            <select value={intervalMinutes} onChange={event => setIntervalMinutes(Number(event.target.value))} aria-label="Interval">
              {meta.intervals.map(value => <option key={value} value={value}>{value} min</option>)}
            </select>
          </label>
          <label>Strikes
            <select value={strikes} onChange={event => setStrikes(Number(event.target.value))} aria-label="Strike range">
              {meta.strikeWindows.map(value => <option key={value} value={value}>ATM ± {value}</option>)}
            </select>
          </label>
        </>}
        {tab === "chain" && <>
          <div className="oi-segments" role="group" aria-label="Build-up window">
            <span className="oi-segments-label">Build-up window</span>
            {OI_CHANGE_WINDOWS.map(([minutes, label]) => <button key={minutes} type="button" aria-pressed={changeWindow === minutes} className={changeWindow === minutes ? "active" : ""}
              onClick={() => { setChangeWindow(minutes); saveChangeWindow(minutes); }}>{label}</button>)}
          </div>
          <div className="oi-segments" role="group" aria-label="Strikes shown">
            {STRIKE_RANGES.map(([value, label]) => <button key={value} type="button" aria-pressed={strikeRange === value} className={strikeRange === value ? "active" : ""}
              onClick={() => { setStrikeRange(value); saveStrikeRange(value); }}>{label}</button>)}
          </div>
        </>}
        <button type="button" className="oi-refresh" onClick={load} disabled={loading || !expiry} aria-label="Refresh OI data" title="Refresh OI data">
          <RefreshCw size={15} className={loading ? "oi-spin" : ""} /> Refresh
        </button>
      </div>}
    </header>

    <div className="oi-tabs" role="tablist" aria-label="OI views">
      {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}
    </div>

    {error && <p className="oi-notice oi-error" role="alert">{error}</p>}
    {data?.message && <p className="oi-notice">{data.message}</p>}
    {data?.liveMessage && <p className="oi-notice">Live quotes unavailable ({data.liveMessage}) Showing the last recorded snapshot.</p>}
    {data?.baseline === "today's first snapshot" && <p className="oi-notice">OI change is measured from today's first recorded snapshot until previous-day OI is downloaded.</p>}
    {data?.baseline === "unavailable" && <p className="oi-notice">OI change appears once today's OI recording starts (every 3 minutes while Zerodha is connected).</p>}

    {tab === "stocks" && (boardApi ? <StockFno api={boardApi} /> : <p className="oi-notice">Stock F&O data is not connected on this screen.</p>)}

    {tab === "trend" && trend && !trend.message && <>
      <section className="oi-stats" aria-label="Latest OI summary">
        <Stat label={`${indexLabel}`} value={formatPrice(latest?.underlying)} />
        <Stat label="Call OI change" value={compactOi(latest?.callOiChange)} tone={signClass(-(latest?.callOiChange || 0))} />
        <Stat label="Put OI change" value={compactOi(latest?.putOiChange)} tone={signClass(latest?.putOiChange)} />
        <Stat label="Put − Call" value={compactOi(latest?.diff)} tone={signClass(latest?.diff)} />
        <Stat label="Change PCR" value={formatRatio(latest?.changePcr)} />
        <Stat label="Sentiment" value={latest?.sentiment || "--"} tone={latest ? `oi-sentiment-text-${latest.sentiment.toLowerCase()}` : ""} />
      </section>
      <section className="oi-card">
        <div className="oi-card-head"><h2>Live OI change</h2><span>ATM {trend.atm} ± {strikes} strikes ({trend.strikes.length} strikes) · {trend.interval}-min points</span></div>
        <OiTrendChart series={trend.series} />
      </section>
      <section className="oi-card">
        <div className="oi-card-head"><h2>Trending OI</h2><span>Change since {trend.baseline}; positive Put − Call means more put writing (bullish)</span></div>
        <TrendTable rows={trend.rows} />
      </section>
    </>}

    {tab === "chain" && chain && !chain.message && <>
      <ChainSummary chain={chain} indexLabel={indexLabel} />
      <p className="oi-chain-info">
        build-up window {windowLabel(chain.window)} is {chain.windowStatus?.ready ? "ready" : "warming"}
        {chain.windowStatus && ` — ${chain.windowStatus.minutesRecorded} of ${chain.window} min recorded today (${chain.windowStatus.snapshots} snapshots)`}
        {chain.windowFrom ? `, compared with ${timeLabel(chain.windowFrom)} IST` : ""}; ΔOI(day) and the chain {live ? "are live" : "are from the last recording"}
        {" · "}showing {chain.rows.length} of {chain.totalStrikes || chain.rows.length} strikes
      </p>
      <p className="oi-chain-legend">
        <span><span className="oi-buildup oi-buildup-lb">LB</span> long build-up · OI↑ premium↑</span>
        <span><span className="oi-buildup oi-buildup-sb">SB</span> short build-up (writing) · OI↑ premium↓</span>
        <span><span className="oi-buildup oi-buildup-sc">SC</span> short covering · OI↓ premium↑</span>
        <span><span className="oi-buildup oi-buildup-lu">LU</span> long unwinding · OI↓ premium↓</span>
        <span className="oi-muted">ΔOI({windowLabel(chain.window)}) and the tags read the selected window; ΔOI(day) reads against the previous session's close</span>
      </p>
      <section className="oi-card" aria-label="Option chain">
        <ChainTable data={chain} flashes={flashes} />
      </section>
      <section className="oi-card">
        <div className="oi-card-head"><h2>OI by strike</h2><span>Shaded column is ATM</span></div>
        <OiStrikeBars rows={chain.rows} atm={chain.atm} maxCallStrike={chain.maxCallOiStrike} maxPutStrike={chain.maxPutOiStrike} />
      </section>
    </>}
    <p className="oi-disclaimer">Utraders describes the market. It does not tell you to buy or sell. F&amp;O trading is high risk and most traders lose money. Please talk to a SEBI-registered adviser before you invest.</p>
  </main>;
}

// Live index prices re-render the app every second; this page only changes with its own props.
export default React.memo(OiAnalysis);
