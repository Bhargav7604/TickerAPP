import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Lock, Pause, Play, ShieldAlert, XCircle } from "lucide-react";
import "../traderDesk.css";
import { clockOf, dateOf, price, rupees } from "../traderData";
import { LANGUAGES, saveLanguage, translate } from "../i18n";

const TABS = [["plan", "Plan a trade"], ["trades", "My trades"], ["coach", "Coach"], ["alerts", "Alerts"], ["replay", "Replay"], ["expiry", "Expiry report"], ["money", "My money"]];
const INDEXES = [["nifty", "NIFTY"], ["banknifty", "BANKNIFTY"], ["sensex", "SENSEX"], ["stock", "Stock F&O"]];
const EMOTIONS = [["calm", "Calm"], ["fear", "Fear"], ["greed", "Greed"], ["anger", "Angry"], ["revenge", "Winning back a loss"]];
const monthNow = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }).slice(0, 7);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function Note({ tone = "info", children }) {
  const Icon = tone === "danger" ? ShieldAlert : tone === "warning" ? AlertTriangle : CheckCircle2;
  return <p className={`desk-note is-${tone}`}><Icon size={17} aria-hidden="true" /><span>{children}</span></p>;
}

function CheckIn({ api, onDone }) {
  const [answers, setAnswers] = useState({ sleptWell: null, upset: null, chasingLoss: null });
  const questions = [["sleptWell", "Did you sleep well?"], ["upset", "Are you upset about anything?"], ["chasingLoss", "Are you trying to win back a loss?"]];
  const ready = Object.values(answers).every(value => value !== null);
  return <section className="desk-card desk-checkin" aria-label="Morning check-in">
    <h2>Before your first trade: three quick questions</h2>
    {questions.map(([key, text]) => <div key={key} className="desk-question"><span>{text}</span>
      <div role="group" aria-label={text}>{[[true, "Yes"], [false, "No"]].map(([value, label]) =>
        <button key={label} type="button" aria-pressed={answers[key] === value} className={answers[key] === value ? "active" : ""} onClick={() => setAnswers(old => ({ ...old, [key]: value }))}>{label}</button>)}</div>
    </div>)}
    <button type="button" className="desk-primary" disabled={!ready} onClick={async () => onDone(await api.checkin(answers))}>Save answers</button>
  </section>;
}

function Checklist({ checklist }) {
  return <div className="desk-checklist" aria-label="Pre-trade checklist">
    <div className={`desk-verdict ${checklist.ready ? "is-ready" : "is-not-ready"}`}>{checklist.ready ? <CheckCircle2 size={22} /> : <XCircle size={22} />}{checklist.verdict}</div>
    <ul>{checklist.checks.map(check => <li key={check.name} className={check.ok ? "is-ok" : "is-bad"}>
      <span className="desk-lamp" aria-hidden="true" /><b>{check.name}</b><span>{check.text}</span></li>)}</ul>
  </div>;
}

function PlanTab({ api, overview, onSaved }) {
  const [form, setForm] = useState({ index: "nifty", instrument: "CE", side: "buy", lots: 1, expiry: "", strike: "", entry: "", stop: "", emotion: "calm", symbol: "", lotSize: "" });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(null);
  const expiries = form.index === "stock" ? [] : overview.calendar[form.index] || [];
  const update = (key, value) => { setForm(old => ({ ...old, [key]: value })); setResult(null); setSaved(null); };
  const payload = () => ({
    ...(form.index === "stock" ? { symbol: form.symbol, lotSize: form.lotSize } : { index: form.index, expiry: form.expiry || expiries[0]?.date }),
    instrument: form.instrument, side: form.side, lots: form.lots, strike: form.instrument === "FUT" ? null : form.strike,
    entry: form.entry, stop: form.stop, emotion: form.emotion,
  });
  const check = async event => {
    event.preventDefault();
    try { setResult(await api.plan(payload())); setError(""); } catch (exc) { setError(exc.message); setResult(null); }
  };
  const save = async () => {
    try { setSaved(await api.addTrade(payload())); setError(""); onSaved(); } catch (exc) { setError(exc.message); }
  };
  const practice = overview.profile.practiceMode;
  return <div className="desk-plan">
    <form className="desk-card desk-form" onSubmit={check} aria-label="Plan a trade">
      <label>Market<select value={form.index} onChange={event => update("index", event.target.value)}>{INDEXES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {form.index === "stock" ? <>
        <label>Contract symbol<input value={form.symbol} onChange={event => update("symbol", event.target.value)} placeholder="e.g. RELIANCE26NOVFUT" /></label>
        <label>Lot size<input type="number" min="1" value={form.lotSize} onChange={event => update("lotSize", event.target.value)} placeholder="from your broker" /></label>
      </> : <label>Expiry<select value={form.expiry || expiries[0]?.date || ""} onChange={event => update("expiry", event.target.value)}>{expiries.map(item => <option key={item.date} value={item.date}>{item.label}</option>)}</select></label>}
      <label>Type<select value={form.instrument} onChange={event => update("instrument", event.target.value)}><option value="CE">Call option</option><option value="PE">Put option</option><option value="FUT">Futures</option></select></label>
      {form.instrument !== "FUT" && <label>Strike<input type="number" value={form.strike} onChange={event => update("strike", event.target.value)} placeholder="e.g. 22600" /></label>}
      <label>Buy or sell<select value={form.side} onChange={event => update("side", event.target.value)}><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
      <label>Lots<input type="number" min="1" value={form.lots} onChange={event => update("lots", event.target.value)} /></label>
      <label>Price<input type="number" step="0.05" value={form.entry} onChange={event => update("entry", event.target.value)} placeholder="blank = latest price" /></label>
      <label>Exit if wrong (stop)<input type="number" step="0.05" value={form.stop} onChange={event => update("stop", event.target.value)} placeholder="blank = suggested" /></label>
      <label>How do you feel?<select value={form.emotion} onChange={event => update("emotion", event.target.value)}>{EMOTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button type="submit" className="desk-primary">Check this trade</button>
    </form>
    {error && <p className="desk-error" role="alert">{error}</p>}
    {result && <div className="desk-result">
      <Checklist checklist={result.checklist} />
      {result.dangerNow && <Note tone="danger">{result.dangerNow}</Note>}
      {result.warnings.map(text => <Note key={text} tone="warning">{text}</Note>)}
      <section className="desk-card"><h2>Money guard</h2>
        <p>{result.sizing.text}</p>
        {result.sizing.warning && <Note tone="danger">{result.sizing.warning}</Note>}
        <p className="desk-muted">Exit if wrong at <b>{price(result.sizing.stop)}</b>{result.sizing.stopSuggested ? " (suggested)" : ""} · price {price(result.trade.entry)} · {practice ? "practice money" : "real money"}</p>
      </section>
      {result.breakEven && <section className="desk-card"><h2>Will this option make money?</h2><p>{result.breakEven.text}</p></section>}
      {result.sellerAlarm && <section className="desk-card is-danger"><h2>Option seller safety alarm</h2><p>{result.sellerAlarm.text}</p></section>}
      {result.lottery && <Note tone="danger">{result.lottery}</Note>}
      {result.timeLoss && <Note tone="warning">{result.timeLoss}</Note>}
      {result.stockExpiry && <Note tone="danger">{result.stockExpiry.text}</Note>}
      {result.whatIf.length > 0 && <section className="desk-card"><h2>What if</h2><ul className="desk-whatif">{result.whatIf.map(item =>
        <li key={item.label}><span>{item.label}</span><b className={item.pnl >= 0 ? "desk-up" : "desk-down"}>{item.pnl >= 0 ? "+" : ""}{rupees(item.pnl)}</b></li>)}</ul></section>}
      <button type="button" className="desk-primary" onClick={save}>Add to my trade list ({practice ? "practice money" : "real money"})</button>
      {saved && <Note>Saved to your trade list.{saved.warnings.length ? " The coach noted: " + saved.warnings.join(" ") : ""}</Note>}
    </div>}
  </div>;
}

function TradesTab({ api, overview, onChanged }) {
  const [exits, setExits] = useState({});
  const [lesson, setLesson] = useState(null);
  const [error, setError] = useState("");
  const close = async trade => {
    try {
      const result = await api.closeTrade(trade.id, exits[trade.id]);
      setLesson(result.lesson);
      setError("");
      onChanged();
    } catch (exc) { setError(exc.message); }
  };
  return <div>
    {error && <p className="desk-error" role="alert">{error}</p>}
    {lesson && <Note tone="warning">If you had followed the plan: {lesson.text}</Note>}
    <section className="desk-card"><h2>Open trades</h2>
      {!overview.openTrades.length && <p className="desk-muted">No open trades.</p>}
      {overview.openTrades.map(trade => <article key={trade.id} className="desk-trade">
        <header><b>{trade.symbol}</b><span>{trade.side} {trade.lots} lot{trade.lots !== 1 ? "s" : ""} at {price(trade.entry)}{trade.practice ? " · practice" : ""}</span></header>
        <p className="desk-muted">Stop {price(trade.stop)} · now {price(trade.current)}</p>
        {trade.protect && <Note>{trade.protect.text}</Note>}
        {trade.stockExpiry && <Note tone="danger">{trade.stockExpiry.text}</Note>}
        <div className="desk-close"><input type="number" step="0.05" aria-label={`Exit price for ${trade.symbol}`} placeholder="Exit price" value={exits[trade.id] || ""} onChange={event => setExits(old => ({ ...old, [trade.id]: event.target.value }))} />
          <button type="button" className="desk-secondary" disabled={!exits[trade.id]} onClick={() => close(trade)}>Close trade</button></div>
      </article>)}
    </section>
    <section className="desk-card"><h2>Closed trades</h2>
      <div className="desk-table-scroll"><table className="desk-table"><thead><tr><th>Date</th><th>Contract</th><th>Side</th><th>Lots</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>Followed plan</th><th>Mood</th></tr></thead>
        <tbody>{overview.recentTrades.map(trade => <tr key={trade.id}><td>{dateOf(trade.openedAt)}</td><td>{trade.symbol}{trade.practice ? " (practice)" : ""}</td><td>{trade.side}</td><td>{trade.lots}</td>
          <td>{price(trade.entry)}</td><td>{price(trade.exit)}</td><td className={trade.pnl > 0 ? "desk-up" : trade.pnl < 0 ? "desk-down" : ""}>{rupees(trade.pnl)}</td>
          <td>{trade.followedPlan ? "✓" : "✗"}</td><td>{trade.emotion}</td></tr>)}</tbody></table></div>
      {!overview.recentTrades.length && <p className="desk-muted">Closed trades appear here.</p>}
    </section>
  </div>;
}

function CoachTab({ overview }) {
  const { licence, dangerTimes, emotionCost, lessons, coolingOff } = overview;
  return <div className="desk-grid">
    <section className="desk-card"><h2>Learner's licence</h2><p className="desk-big">{licence.name}</p><p>{licence.text}</p>
      <ol className="desk-levels">{["Learner", "Small", "Standard"].map((name, level) => <li key={name} className={level <= licence.level ? "is-done" : ""}>{name}</li>)}</ol></section>
    <section className="desk-card"><h2>Your danger times</h2>
      {dangerTimes.now && <Note tone="danger">{dangerTimes.now}</Note>}
      {dangerTimes.times.length ? <ul>{dangerTimes.times.map(item => <li key={item.label}>{item.label}: lost {item.lossRate}% of {item.trades} trades ({rupees(item.lost)})</li>)}</ul>
        : <p className="desk-muted">Utraders learns these from your trade list (needs at least 3 trades at the same time).</p>}</section>
    <section className="desk-card"><h2>What feelings cost you</h2><p>{emotionCost.text}</p></section>
    <section className="desk-card"><h2>If you had followed the plan</h2>
      <p className="desk-big">{rupees(lessons.totalSaved)}</p><p className="desk-muted">could have been saved on recent losing trades.</p>
      <ul>{lessons.lessons.map(item => <li key={item.tradeId}>{item.date} {item.symbol}: {item.text}</li>)}</ul></section>
    {coolingOff.active && <section className="desk-card is-danger"><h2>Cooling-off</h2><p>{coolingOff.text}</p><p className="desk-muted">{coolingOff.lesson}</p></section>}
    <section className="desk-card"><h2>This month (real money)</h2><p className={`desk-big ${overview.monthPnl >= 0 ? "desk-up" : "desk-down"}`}>{rupees(overview.monthPnl)}</p></section>
  </div>;
}

function AlertsTab({ api, lang }) {
  const [month, setMonth] = useState(monthNow);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    api.alerts(month, abort.signal).then(setData).catch(exc => { if (!abort.signal.aborted) setError(exc.message); });
    return () => abort.abort();
  }, [api, month]);
  if (error) return <p className="desk-error" role="alert">{error}</p>;
  if (!data) return <p role="status">Loading alerts…</p>;
  const card = data.reportCard;
  return <div>
    <section className="desk-grid">
      <div className="desk-card"><h2>Report card</h2><label className="desk-inline">Month<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label>
        <p className="desk-big">{card.hitRate == null ? "--" : `${card.hitRate}%`}</p><p>{card.text}</p>
        <table className="desk-table desk-small"><thead><tr><th /><th>Right</th><th>Wrong</th><th>Waiting</th></tr></thead>
          <tbody>{["strong", "medium", "weak"].map(key => <tr key={key}><th>{key}</th><td>{card.byStrength[key].right}</td><td>{card.byStrength[key].wrong}</td><td>{card.byStrength[key].pending}</td></tr>)}</tbody></table></div>
      <div className="desk-card"><h2><Lock size={16} aria-hidden="true" /> Locked record</h2>
        <p className={data.record.intact ? "desk-up" : "desk-down"}><b>{data.record.intact ? "Record intact" : `Record changed at alert ${data.record.brokenAt}`}</b></p>
        <p className="desk-muted">{data.record.count} alerts saved the moment they were sent, each sealed with the one before it. All wins and all losses are shown.</p></div>
    </section>
    <section className="desk-card"><h2>Alerts</h2>
      {!data.alerts.length && <p className="desk-muted">No alerts yet. Utraders sends only a few important alerts each day.</p>}
      <ul className="desk-alerts">{data.alerts.map(alert => <li key={alert.id}>
        <span className="desk-time">{dateOf(alert.time)} {clockOf(alert.time)}</span>
        <span className={`desk-chip is-${alert.strength}`}>{alert.strength}</span><span className={`desk-chip is-${alert.status}`}>{alert.status}</span>
        <span className="desk-alert-text">{translate(alert.message, lang)} <small>at {price(alert.price)}</small></span>
        <span className={`desk-chip is-${alert.outcome || "pending"}`}>{alert.outcome || "checking"}</span>
        <a href={`https://wa.me/?text=${encodeURIComponent(`Utraders alert (${alert.strength}, ${alert.status}): ${alert.message}`)}`} target="_blank" rel="noopener noreferrer">Share</a>
      </li>)}</ul></section>
  </div>;
}

function ReplayChart({ prices, cursor, alerts }) {
  if (prices.length < 2) return <p className="desk-muted">No price data for this day.</p>;
  const width = 640, height = 180, values = prices.map(point => point.price);
  const low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
  const x = index => index / (prices.length - 1) * width;
  const y = value => height - (value - low) / span * (height - 16) - 8;
  const path = prices.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.price).toFixed(1)}`).join(" ");
  const at = Math.min(cursor, prices.length - 1);
  return <svg viewBox={`0 0 ${width} ${height}`} className="desk-replay-chart" role="img" aria-label="Price through the day">
    <path d={path} className="desk-replay-line" />
    {alerts.map(alert => {
      const index = prices.findIndex(point => point.time >= alert.time);
      return index >= 0 && index <= at ? <circle key={alert.id} cx={x(index)} cy={y(prices[index].price)} r="5" className={`desk-replay-alert is-${alert.outcome || "pending"}`} /> : null;
    })}
    <line x1={x(at)} x2={x(at)} y1="0" y2={height} className="desk-replay-cursor" />
    <circle cx={x(at)} cy={y(prices[at].price)} r="5" className="desk-replay-dot" />
  </svg>;
}

function ReplayTab({ api }) {
  const [data, setData] = useState(null);
  const [date, setDate] = useState("");
  const [index, setIndex] = useState("nifty");
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    api.replay(date, abort.signal).then(result => { setData(result); setCursor(0); setPlaying(false); }).catch(exc => { if (!abort.signal.aborted) setError(exc.message); });
    return () => abort.abort();
  }, [api, date]);
  const prices = data?.indexes[index]?.prices || [];
  useEffect(() => {
    if (!playing) return undefined;
    const timer = setInterval(() => setCursor(value => { if (value >= prices.length - 1) { setPlaying(false); return value; } return value + 1; }), 400);
    return () => clearInterval(timer);
  }, [playing, prices.length]);
  if (error) return <p className="desk-error" role="alert">{error}</p>;
  if (!data) return <p role="status">Loading replay…</p>;
  const point = prices[Math.min(cursor, prices.length - 1)];
  const alerts = data.alerts.filter(alert => alert.index === index);
  const oi = data.indexes[index].oi.filter(item => point && item.time <= point.time).slice(-1)[0];
  return <section className="desk-card">
    <div className="desk-replay-controls">
      <label className="desk-inline">Day<select value={data.date} onChange={event => setDate(event.target.value)}>{data.days.map(day => <option key={day} value={day}>{day}</option>)}</select></label>
      <div role="group" aria-label="Index" className="desk-segments">{[["nifty", "NIFTY"], ["banknifty", "BANKNIFTY"], ["sensex", "SENSEX"]].map(([key, label]) =>
        <button key={key} type="button" aria-pressed={index === key} className={index === key ? "active" : ""} onClick={() => { setIndex(key); setCursor(0); }}>{label}</button>)}</div>
      <button type="button" className="desk-secondary" onClick={() => setPlaying(value => !value)} disabled={prices.length < 2}>{playing ? <Pause size={16} /> : <Play size={16} />}{playing ? "Pause" : "Play"}</button>
    </div>
    <ReplayChart prices={prices} cursor={cursor} alerts={alerts} />
    <input type="range" min="0" max={Math.max(prices.length - 1, 0)} value={cursor} onChange={event => { setCursor(Number(event.target.value)); setPlaying(false); }} aria-label="Replay time" className="desk-slider" />
    {point && <p className="desk-replay-now"><b>{clockOf(point.time)} IST</b> · futures {price(point.price)} · net lots {Math.round(point.netLots).toLocaleString("en-IN")}
      {oi && <> · put − call OI {oi.diff > 0 ? "+" : ""}{Math.round(oi.diff).toLocaleString("en-IN")}</>}</p>}
    <ul className="desk-alerts">{alerts.filter(alert => point && alert.time <= point.time).map(alert => <li key={alert.id}>
      <span className="desk-time">{clockOf(alert.time)}</span><span className={`desk-chip is-${alert.strength}`}>{alert.strength}</span>
      <span className="desk-alert-text">{alert.message}</span><span className={`desk-chip is-${alert.outcome || "pending"}`}>{alert.outcome || "checking"}</span></li>)}</ul>
  </section>;
}

function ExpiryTab({ api, overview }) {
  const [index, setIndex] = useState("nifty");
  const [date, setDate] = useState(today);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.expiryReport(index, date).then(result => { setReport(result); setError(""); }).catch(exc => setError(exc.message));
  }, [api, index, date]);
  return <section className="desk-card">
    <div className="desk-replay-controls">
      <div role="group" aria-label="Index" className="desk-segments">{[["nifty", "NIFTY"], ["banknifty", "BANKNIFTY"], ["sensex", "SENSEX"]].map(([key, label]) =>
        <button key={key} type="button" aria-pressed={index === key} className={index === key ? "active" : ""} onClick={() => setIndex(key)}>{label}</button>)}</div>
      <label className="desk-inline">Expiry day<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
    </div>
    {error && <p className="desk-error">{error}</p>}
    {report && <div className="desk-grid">
      <div className="desk-card"><h2>What happened</h2><p>{report.market?.text || "No market data recorded for this day."}</p></div>
      <div className="desk-card"><h2>Alerts</h2><p>{report.alerts.text}</p></div>
      <div className="desk-card"><h2>You</h2><p>{report.you.text}</p></div>
    </div>}
    <p className="desk-muted">Next expiries: {(overview.calendar[index] || []).map(item => item.label).join(", ")}</p>
  </section>;
}

function MoneyTab({ api, overview, onSaved, lang, setLang }) {
  const profile = overview.profile;
  const [form, setForm] = useState({ capital: profile.capital || "", riskPct: profile.riskPct, monthlyLossLimit: profile.monthlyLossLimit || "", telegramChatId: "" });
  const [message, setMessage] = useState("");
  const save = async extra => {
    try { await api.saveProfile({ ...form, ...extra }); setMessage("Saved."); onSaved(); } catch (exc) { setMessage(exc.message); }
  };
  const link = profile.mentorLink ? `${window.location.origin}/#mentor/${profile.mentorLink}` : "";
  return <div className="desk-grid">
    <section className="desk-card"><h2>Money guard</h2>
      <label>Trading money (₹)<input type="number" min="0" value={form.capital} onChange={event => setForm(old => ({ ...old, capital: event.target.value }))} /></label>
      <label>Risk per trade (% of money, max 5)<input type="number" min="0.1" max="5" step="0.1" value={form.riskPct} onChange={event => setForm(old => ({ ...old, riskPct: event.target.value }))} /></label>
      <label>Monthly loss limit (₹)<input type="number" min="0" value={form.monthlyLossLimit} onChange={event => setForm(old => ({ ...old, monthlyLossLimit: event.target.value }))} /></label>
      <button type="button" className="desk-primary" onClick={() => save({})}>Save</button>
      {message && <p className="desk-muted" role="status">{message}</p>}
    </section>
    <section className="desk-card"><h2>Practice money</h2>
      <p className="desk-big">{rupees(profile.practiceBalance)}</p>
      <p className="desk-muted">Same screens and alerts, with pretend money. {profile.practiceMode ? "You are using practice money." : "You are using real money."}</p>
      <div className="desk-row">
        <button type="button" className="desk-secondary" onClick={() => save({ practiceMode: !profile.practiceMode })}>{profile.practiceMode ? "Switch to real money" : "Switch to practice money"}</button>
        <button type="button" className="desk-secondary" onClick={() => save({ resetPractice: true })}>Reset to ₹1,00,000</button>
      </div>
    </section>
    <section className="desk-card"><h2>Language</h2>
      <div role="group" aria-label="Language" className="desk-segments">{LANGUAGES.map(([key, label]) =>
        <button key={key} type="button" aria-pressed={lang === key} className={lang === key ? "active" : ""} onClick={() => { setLang(key); saveLanguage(key); save({ language: key }); }}>{label}</button>)}</div>
    </section>
    <section className="desk-card"><h2>Alerts on Telegram</h2>
      <p className="desk-muted">{profile.telegramLinked ? "Telegram is linked." : "Open the Utraders bot in Telegram, send /start, then paste your chat ID here."}</p>
      <label>Telegram chat ID<input value={form.telegramChatId} onChange={event => setForm(old => ({ ...old, telegramChatId: event.target.value }))} placeholder="e.g. 123456789" /></label>
      <button type="button" className="desk-secondary" onClick={() => save({ telegramChatId: form.telegramChatId })}>Link Telegram</button>
    </section>
    <section className="desk-card"><h2>Share with your mentor</h2>
      <p className="desk-muted">Your mentor sees your trade list, discipline and lessons (read-only). Turn the link off any time.</p>
      {link ? <>
        <div className="desk-row"><input readOnly value={link} aria-label="Mentor link" /><button type="button" className="desk-secondary" onClick={() => navigator.clipboard?.writeText(link)}><Copy size={15} />Copy</button></div>
        <button type="button" className="desk-secondary" onClick={async () => { await api.mentorLink(true); onSaved(); }}>Turn off link</button>
      </> : <button type="button" className="desk-primary" onClick={async () => { await api.mentorLink(false); onSaved(); }}>Create mentor link</button>}
    </section>
  </div>;
}

export default function TraderDesk({ api }) {
  const [tab, setTab] = useState("plan");
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");
  const [lang, setLang] = useState(() => { try { return localStorage.getItem("utraders-language") || "en"; } catch { return "en"; } });
  const abort = useRef(null);
  const load = useCallback(async () => {
    abort.current?.abort();
    abort.current = new AbortController();
    try { setOverview(await api.overview(abort.current.signal)); setError(""); } catch (exc) { if (!abort.current.signal.aborted) setError(exc.message); }
  }, [api]);
  useEffect(() => { load(); const timer = setInterval(load, 60000); return () => { clearInterval(timer); abort.current?.abort(); }; }, [load]);
  const body = useMemo(() => {
    if (!overview) return null;
    if (tab === "plan") return <PlanTab api={api} overview={overview} onSaved={load} />;
    if (tab === "trades") return <TradesTab api={api} overview={overview} onChanged={load} />;
    if (tab === "coach") return <CoachTab overview={overview} />;
    if (tab === "alerts") return <AlertsTab api={api} lang={lang} />;
    if (tab === "replay") return <ReplayTab api={api} />;
    if (tab === "expiry") return <ExpiryTab api={api} overview={overview} />;
    return <MoneyTab api={api} overview={overview} onSaved={load} lang={lang} setLang={setLang} />;
  }, [api, overview, tab, load, lang]);
  return <main className="desk-page">
    <header className="desk-head">
      <div><h1>My trading</h1><span>Protect your money first.</span></div>
      {overview && <div className="desk-badges">
        <span className={`desk-mode ${overview.profile.practiceMode ? "is-practice" : "is-real"}`}>{overview.profile.practiceMode ? `Practice money · ${rupees(overview.profile.practiceBalance)}` : "Real money"}</span>
        <span className="desk-mode">Licence: {overview.licence.name}</span>
      </div>}
    </header>
    {error && <p className="desk-error" role="alert">{error}</p>}
    {overview?.coolingOff.active && <Note tone="danger">{overview.coolingOff.text}</Note>}
    {overview?.dangerTimes.now && <Note tone="danger">{overview.dangerTimes.now}</Note>}
    {overview && !overview.checkin.done && <CheckIn api={api} onDone={load} />}
    {overview && overview.checkin.done && !overview.checkin.ok && <Note tone="warning">{overview.checkin.text}</Note>}
    <nav className="desk-tabs" aria-label="My trading sections" role="tablist">
      {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}
    </nav>
    {!overview && !error && <p role="status">Loading your trading desk…</p>}
    {body}
    {overview && <p className="desk-disclaimer">{translate(overview.disclaimer, lang)}</p>}
  </main>;
}
