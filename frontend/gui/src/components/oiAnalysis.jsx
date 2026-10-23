import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import OiTrendChart from "./oiTrendChart";
import OiStrikeBars from "./oiStrikeBars";
import "../oiAnalysis.css";
import {
  BUILDUP_SHORT, compactOi, formatOi, formatPct, formatPrice, formatRatio, formatSignedOi, formatSignedPrice,
  OI_INDEXES, signClass, timeLabel,
} from "../oiData";

const TREND_REFRESH_MS = 30000;
const LIVE_REFRESH_MS = 3000;
const TABS = [["trend", "OI Trend"], ["chain", "Option Chain"]];

function Stat({ label, value, tone }) {
  return <div className="oi-stat"><span>{label}</span><strong className={tone || ""}>{value}</strong></div>;
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

function ChainTable({ data, flashes = {} }) {
  const side = (row, key, value) => <>
    {key === "call" && <td><BuildupTag value={value?.buildup} /></td>}
    {(key === "call" ? ["oi", "oiChange", "iv", "ltp", "ltpChange"] : ["ltpChange", "ltp", "iv", "oiChange", "oi"]).map(field => {
      const raw = value?.[field];
      const text = field === "oi" ? formatOi(raw) : field === "oiChange" ? formatSignedOi(raw)
        : field === "iv" ? (raw == null ? "--" : raw.toFixed(1)) : field === "ltpChange" ? formatSignedPrice(raw) : formatPrice(raw);
      const flash = flashes[`${row.strike}:${key}:${field}`];
      return <td key={field} className={`${field.endsWith("Change") ? signClass(raw) : ""}${flash ? ` oi-tick-${flash}` : ""}`}>{text}</td>;
    })}
    {key === "put" && <td><BuildupTag value={value?.buildup} /></td>}
  </>;
  return <div className="oi-table-scroll"><table className="oi-table oi-chain">
    <caption className="sr-only">Option chain with OI build-up</caption>
    <thead>
      <tr><th colSpan="6" className="oi-side-call">Calls</th><th rowSpan="2" className="oi-strike-head">Strike</th><th colSpan="6" className="oi-side-put">Puts</th><th rowSpan="2">PCR</th></tr>
      <tr>{["Build-up", "OI", "OI chg", "IV", "LTP", "LTP chg"].map(label => <th key={`c-${label}`} scope="col">{label}</th>)}
        {["LTP chg", "LTP", "IV", "OI chg", "OI", "Build-up"].map(label => <th key={`p-${label}`} scope="col">{label}</th>)}</tr>
    </thead>
    <tbody>{data.rows.map(row => {
      const itmCall = data.underlying && row.strike < data.underlying;
      const itmPut = data.underlying && row.strike > data.underlying;
      return <tr key={row.strike} className={`${row.strike === data.atm ? "is-atm" : ""} ${itmCall ? "itm-call" : ""} ${itmPut ? "itm-put" : ""}`}>
        {side(row, "call", row.call)}
        <th scope="row" className="oi-strike">{row.strike}{row.strike === data.atm && <small>ATM</small>}</th>
        {side(row, "put", row.put)}
        <td>{formatRatio(row.pcr)}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export default function OiAnalysis({ api }) {
  const [index, setIndex] = useState("nifty");
  const [tab, setTab] = useState("trend");
  const [meta, setMeta] = useState({ expiries: [], recorded: [], intervals: [3, 6, 15, 30, 60], strikeWindows: [5, 7, 10, 15] });
  const [expiry, setExpiry] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(3);
  const [strikes, setStrikes] = useState(7);
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
    if (!expiry) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    nextDelay.current = TREND_REFRESH_MS;
    try {
      if (tab === "trend") {
        setTrend(await api.trend(index, expiry, intervalMinutes, strikes, abort.signal));
      } else {
        let next = await api.liveChain(index, expiry, abort.signal).catch(exc => ({ live: false, message: exc.message }));
        const isLive = Boolean(next.live && next.rows?.length);
        if (isLive) nextDelay.current = next.retryAfterMs || LIVE_REFRESH_MS;
        else if (next.live) nextDelay.current = next.retryAfterMs || 1000;
        else next = { ...(await api.chain(index, expiry, abort.signal)), liveMessage: next.message };
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
  }, [api, index, expiry, tab, intervalMinutes, strikes]);

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

  const data = tab === "trend" ? trend : chain;
  const latest = trend?.rows?.[0];
  const indexLabel = OI_INDEXES.find(([key]) => key === index)[1];

  return <main className="oi-page">
    <header className="oi-command">
      <div className="oi-title">
        <h1>OI Analysis</h1>
        <span>{tab === "chain" && live && <b className="oi-live-badge">LIVE</b>}{indexLabel} options · {refreshedAt ? `updated ${new Date(refreshedAt).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" })} IST` : "loading"} · {tab === "chain" && live ? "live quotes every 3 sec" : "refreshes every 30 sec"}</span>
      </div>
      <div className="oi-controls">
        <div className="oi-segments" role="group" aria-label="Index">
          {OI_INDEXES.map(([key, label]) => <button key={key} type="button" aria-pressed={index === key} className={index === key ? "active" : ""} onClick={() => setIndex(key)}>{label}</button>)}
        </div>
        <label>Expiry
          <select value={expiry} onChange={event => setExpiry(event.target.value)} aria-label="Expiry">
            {meta.expiries.map(value => <option key={value} value={value}>{new Date(value + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}{meta.recorded.includes(value) ? "" : " (no data yet)"}</option>)}
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
        <button type="button" className="oi-icon" onClick={load} disabled={loading || !expiry} aria-label="Refresh OI data" title="Refresh OI data">
          <RefreshCw size={17} className={loading ? "oi-spin" : ""} />
        </button>
      </div>
    </header>

    <div className="oi-tabs" role="tablist" aria-label="OI views">
      {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}
    </div>

    {error && <p className="oi-notice oi-error" role="alert">{error}</p>}
    {data?.message && <p className="oi-notice">{data.message}</p>}
    {data?.liveMessage && <p className="oi-notice">Live quotes unavailable ({data.liveMessage}) Showing the last recorded snapshot.</p>}
    {data?.baseline === "today's first snapshot" && <p className="oi-notice">OI change is measured from today's first recorded snapshot until previous-day OI is downloaded.</p>}
    {data?.baseline === "unavailable" && <p className="oi-notice">OI change appears once today's OI recording starts (every 3 minutes while Zerodha is connected).</p>}

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
      <section className="oi-stats" aria-label="Option chain summary">
        <Stat label={indexLabel} value={formatPrice(chain.underlying)} />
        <Stat label="ATM strike" value={chain.atm ?? "--"} />
        <Stat label="Total call OI" value={compactOi(chain.totals?.callOi)} />
        <Stat label="Total put OI" value={compactOi(chain.totals?.putOi)} />
        <Stat label="PCR (OI)" value={formatRatio(chain.totals?.pcr)} />
        <Stat label={live ? "Live quote" : "As of"} value={chain.bucketTime ? `${new Date(chain.bucketTime * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" })} IST` : "--"} />
      </section>
      <section className="oi-card">
        <div className="oi-card-head"><h2>OI by strike</h2><span>Shaded column is ATM</span></div>
        <OiStrikeBars rows={chain.rows} atm={chain.atm} maxCallStrike={chain.maxCallOiStrike} maxPutStrike={chain.maxPutOiStrike} />
      </section>
      <section className="oi-card">
        <div className="oi-card-head"><h2>Option chain</h2>
          <span className="oi-key"><span className="oi-buildup oi-buildup-lb">LB</span> Long build-up <span className="oi-buildup oi-buildup-sb">SB</span> Short build-up <span className="oi-buildup oi-buildup-lu">LU</span> Long unwinding <span className="oi-buildup oi-buildup-sc">SC</span> Short covering</span>
        </div>
        <ChainTable data={chain} flashes={flashes} />
      </section>
    </>}
  </main>;
}
