import React, { useEffect, useRef, useState } from "react";
import { Box, Button, IconButton, TextField, Typography } from "@mui/material";
import { X } from "lucide-react";
import { fp, isNum, levelsOf, useBoard } from "../boardData";
import { BuildTag, DOWN, NameButton, Panel, Pct, StatusChip, UP } from "./boardUi";
import StockDrawer from "./stockDrawer";
import { PageShell, mono } from "../ui/Glass";

const WATCH_KEY = "utraders-board-watch";
const DEFAULT_WATCH = ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "SBIN"];
// STT as per Budget 2026 (from 1 Apr 2026); exchange and stamp are NSE defaults.
export const RATES = {
  eqi: { name: "Equity intraday", stt: [0, 0.025], stamp: 0.003, exch: 0.00297 },
  eqd: { name: "Equity delivery", stt: [0.1, 0.1], stamp: 0.015, exch: 0.00297 },
  fut: { name: "Futures", stt: [0, 0.05], stamp: 0.002, exch: 0.00173 },
  opt: { name: "Options (premium)", stt: [0, 0.15], stamp: 0.003, exch: 0.03503 },
};
const RISK_FREE = 0.065;

/** Numbers as typed: commas allowed, anything else is 0. */
export const num = value => parseFloat(String(value ?? "").replace(/,/g, "")) || 0;
export const inr = value => `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const cumulative = x => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};
/** Black-Scholes fair value of a call ("C") or put ("P"). */
export function blackScholes(spot, strike, years, vol, type, rate = RISK_FREE) {
  if (years <= 0) return Math.max(0, type === "C" ? spot - strike : strike - spot);
  const d1 = (Math.log(spot / strike) + (rate + vol * vol / 2) * years) / (vol * Math.sqrt(years)), d2 = d1 - vol * Math.sqrt(years);
  return type === "C" ? spot * cumulative(d1) - strike * Math.exp(-rate * years) * cumulative(d2)
    : strike * Math.exp(-rate * years) * cumulative(-d2) - spot * cumulative(-d1);
}
export function blackScholesDelta(spot, strike, years, vol, type, rate = RISK_FREE) {
  if (years <= 0) return type === "C" ? (spot > strike ? 1 : 0) : (spot < strike ? -1 : 0);
  const d1 = (Math.log(spot / strike) + (rate + vol * vol / 2) * years) / (vol * Math.sqrt(years));
  return type === "C" ? cumulative(d1) : cumulative(d1) - 1;
}

export function positionSize({ capital, riskPct, entry, stop, lot }) {
  const per = Math.abs(entry - stop), lotSize = Math.max(1, lot || 1);
  if (!per || !entry) return null;
  const qty = Math.floor(capital * riskPct / 100 / per / lotSize) * lotSize;
  const side = entry > stop ? 1 : -1;
  return { qty, lots: qty / lotSize, lotSize, capitalNeeded: qty * entry, maxLoss: qty * per, per, stopPct: per / entry * 100,
    target2: entry + side * 2 * per, target3: entry + side * 3 * per, gain2: qty * per * 2, gain3: qty * per * 3 };
}

export function charges({ buy, sell, qty, brokerage, sttBuy, sttSell, exch, stamp, sebi, gst }) {
  const bought = buy * qty, sold = sell * qty, turnover = bought + sold;
  const brokerageTotal = brokerage * 2;
  const stt = bought * sttBuy / 100 + sold * sttSell / 100;
  const exchange = turnover * exch / 100;
  const sebiFee = turnover * sebi / 1e7;
  const stampDuty = bought * stamp / 100;
  const tax = (brokerageTotal + exchange + sebiFee) * gst / 100;
  const total = brokerageTotal + stt + exchange + sebiFee + stampDuty + tax;
  return { turnover, brokerage: brokerageTotal, stt, exchange, sebi: sebiFee, stamp: stampDuty, gst: tax, total,
    breakeven: qty ? total / qty : NaN, net: sold - bought - total };
}

const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now()));
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
const dayLabel = iso => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });

function Field({ id, label, value, onChange, ...props }) {
  return <TextField id={id} label={label} size="small" value={value} onChange={event => onChange(event.target.value)}
    inputProps={{ inputMode: "decimal", ...props.inputProps }} {...props} />;
}

/** Label / value pairs in two columns. */
function Results({ rows, label }) {
  return <Box data-results={label} sx={{ display: "grid", gridTemplateColumns: "1fr auto", columnGap: 1.5, rowGap: 0.4, mt: 1.5, fontSize: 13 }}>
    {rows.filter(Boolean).map(([name, value, color, strong]) => <React.Fragment key={name}>
      <Box component="span" sx={{ color: "text.secondary", fontWeight: strong ? 800 : 500 }}>{name}</Box>
      <Box component="b" data-result={name} sx={{ ...mono, textAlign: "right", color: color || "text.primary", fontSize: strong ? 15 : 13 }}>{value}</Box>
    </React.Fragment>)}
  </Box>;
}

const formGrid = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.25 };
const Warn = ({ children }) => <Typography role="note" sx={{ mt: 1, px: 1, py: 0.6, borderRadius: 1.5, fontSize: 12.5, fontWeight: 700, color: "warning.main",
  bgcolor: theme => `${theme.palette.warning.main}1f` }}>{children}</Typography>;

function PositionSize() {
  const [form, setForm] = useState({ capital: "500000", risk: "1", entry: "1400", stop: "1386", lot: "1" });
  const set = key => value => setForm(previous => ({ ...previous, [key]: value }));
  const result = positionSize({ capital: num(form.capital), riskPct: num(form.risk), entry: num(form.entry), stop: num(form.stop), lot: num(form.lot) });
  return <Panel title="Position size" note="how many shares for my risk?">
    <Box sx={formGrid}>
      <Field id="ps-capital" label="Capital ₹" value={form.capital} onChange={set("capital")} />
      <Field id="ps-risk" label="Risk per trade %" value={form.risk} onChange={set("risk")} />
      <Field id="ps-entry" label="Entry" value={form.entry} onChange={set("entry")} />
      <Field id="ps-stop" label="Stop-loss" value={form.stop} onChange={set("stop")} />
      <Field id="ps-lot" label="Lot size (1 = cash)" value={form.lot} onChange={set("lot")} />
    </Box>
    {!result ? <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Enter entry and stop-loss.</Typography> : <>
      <Results label="Position size result" rows={[
        ["Quantity", `${result.qty.toLocaleString("en-IN")}${result.lotSize > 1 ? ` (${result.lots} lots)` : ""}`],
        ["Capital needed", inr(result.capitalNeeded)],
        ["Max loss at stop", inr(result.maxLoss), DOWN],
        ["Target 1 : 2", `${fp(result.target2)} (+${inr(result.gain2)})`, UP],
        ["Target 1 : 3", `${fp(result.target3)} (+${inr(result.gain3)})`, UP],
        ["Stop distance", `${result.stopPct.toFixed(2)}%`],
      ]} />
      {result.qty === 0 && <Warn>Risk too small for even one unit/lot — widen risk % or tighten the stop.</Warn>}
      {result.capitalNeeded > num(form.capital) && <Warn>Needs {(result.capitalNeeded / num(form.capital)).toFixed(1)}× your capital — only possible with leverage/margin.</Warn>}
    </>}
  </Panel>;
}

const ratesFor = segment => ({ sttBuy: String(RATES[segment].stt[0]), sttSell: String(RATES[segment].stt[1]),
  stamp: String(RATES[segment].stamp), exch: String(RATES[segment].exch) });

function Charges() {
  const [form, setForm] = useState({ segment: "eqi", buy: "1000", sell: "1010", qty: "100", brokerage: "20", sebi: "10", gst: "18", ...ratesFor("eqi") });
  const set = key => value => setForm(previous => ({ ...previous, [key]: value }));
  const result = charges(Object.fromEntries(["buy", "sell", "qty", "brokerage", "sttBuy", "sttSell", "exch", "stamp", "sebi", "gst"].map(key => [key, num(form[key])])));
  return <Panel title="Brokerage & charges" note="true cost of a trade">
    <Box sx={formGrid}>
      <TextField select id="ch-segment" label="Segment" size="small" value={form.segment} SelectProps={{ native: true }}
        onChange={event => setForm(previous => ({ ...previous, segment: event.target.value, ...ratesFor(event.target.value) }))}>
        {Object.entries(RATES).map(([key, rate]) => <option key={key} value={key}>{rate.name}</option>)}
      </TextField>
      <Field id="ch-buy" label="Buy price" value={form.buy} onChange={set("buy")} />
      <Field id="ch-sell" label="Sell price" value={form.sell} onChange={set("sell")} />
      <Field id="ch-qty" label="Quantity" value={form.qty} onChange={set("qty")} />
      <Field id="ch-brokerage" label="Brokerage / order ₹" value={form.brokerage} onChange={set("brokerage")} />
    </Box>
    <Box component="details" sx={{ mt: 1.25, "& summary": { cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "text.secondary" } }}>
      <summary>Rates used (edit if your broker differs)</summary>
      <Box sx={{ ...formGrid, mt: 1.25 }}>
        <Field id="ch-stt-buy" label="STT buy %" value={form.sttBuy} onChange={set("sttBuy")} />
        <Field id="ch-stt-sell" label="STT sell %" value={form.sttSell} onChange={set("sttSell")} />
        <Field id="ch-exch" label="Exchange %" value={form.exch} onChange={set("exch")} />
        <Field id="ch-stamp" label="Stamp (buy) %" value={form.stamp} onChange={set("stamp")} />
        <Field id="ch-sebi" label="SEBI ₹/crore" value={form.sebi} onChange={set("sebi")} />
        <Field id="ch-gst" label="GST %" value={form.gst} onChange={set("gst")} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        STT as per Budget 2026 (from 1 Apr 2026): futures 0.05% sell, options 0.15% sell premium. Exchange and stamp rates are NSE defaults — check your contract note.
      </Typography>
    </Box>
    <Results label="Charges result" rows={[
      ["Turnover", inr(result.turnover)], ["Brokerage", inr(result.brokerage)], ["STT", inr(result.stt)], ["Exchange txn", inr(result.exchange)],
      ["SEBI fee", inr(result.sebi)], ["Stamp duty", inr(result.stamp)], [`GST (${num(form.gst)}%)`, inr(result.gst)],
      ["Total charges", inr(result.total), DOWN, true],
      ["Points to break even", isNum(result.breakeven) ? result.breakeven.toFixed(2) : "—"],
      ["Net P&L", inr(result.net), result.net >= 0 ? UP : DOWN, true],
    ]} />
  </Panel>;
}

function Pivots({ nifty }) {
  const [form, setForm] = useState({ high: "24120", low: "23860", close: "23980" });
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || !nifty || !isNum(nifty.prevH) || !isNum(nifty.prevL) || !isNum(nifty.prevC)) return;
    filled.current = true;
    setForm({ high: String(nifty.prevH), low: String(nifty.prevL), close: String(nifty.prevC) });
  }, [nifty]);
  const set = key => value => setForm(previous => ({ ...previous, [key]: value }));
  const H = num(form.high), L = num(form.low), C = num(form.close);
  const ok = H > 0 && L > 0 && C > 0;
  const P = ok ? levelsOf(H, L, C) : null;
  const width = P ? (P.TC - P.BC) / P.P * 100 : NaN;
  return <Panel title="Pivot · CPR · Camarilla" note="from yesterday's H/L/C">
    <Box sx={{ ...formGrid, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
      <Field id="pv-high" label="High" value={form.high} onChange={set("high")} />
      <Field id="pv-low" label="Low" value={form.low} onChange={set("low")} />
      <Field id="pv-close" label="Close" value={form.close} onChange={set("close")} />
    </Box>
    {!P ? <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Enter yesterday's high, low and close.</Typography>
      : <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, columnGap: 2 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>Classic</Typography>
          <Results label="Classic pivots" rows={[["R3", fp(P.R3), DOWN], ["R2", fp(P.R2), DOWN], ["R1", fp(P.R1), DOWN], ["Pivot", fp(P.P), "warning.main"],
            ["S1", fp(P.S1), UP], ["S2", fp(P.S2), UP], ["S3", fp(P.S3), UP]]} />
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>CPR</Typography>
          <Results label="Central pivot range" rows={[["TC", fp(P.TC), "warning.main"], ["Pivot", fp(P.P), "warning.main"], ["BC", fp(P.BC), "warning.main"],
            ["Width", `${width.toFixed(2)}%`]]} />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
            {width < 0.25 ? "Narrow → trending day likely" : width > 0.6 ? "Wide → sideways day likely" : "Normal width"}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Camarilla</Typography>
          <Results label="Camarilla levels" rows={[["H4", fp(P.H4), DOWN], ["H3", fp(P.H3), DOWN], ["L3", fp(P.L3), UP], ["L4", fp(P.L4), UP]]} />
        </Box>
      </Box>}
  </Panel>;
}

function OptionPrice({ nifty, niftyDays }) {
  const [form, setForm] = useState({ spot: "23950", strike: "24000", days: "3", iv: "13" });
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || !nifty || !isNum(nifty.ltp)) return;
    filled.current = true;
    setForm(previous => ({ ...previous, spot: String(Math.round(nifty.ltp * 100) / 100), strike: String(Math.round(nifty.ltp / 50) * 50),
      days: isNum(niftyDays) ? String(niftyDays) : previous.days }));
  }, [nifty, niftyDays]);
  const set = key => value => setForm(previous => ({ ...previous, [key]: value }));
  const spot = num(form.spot), strike = num(form.strike), years = Math.max(0, num(form.days)) / 365, vol = num(form.iv) / 100;
  const ok = spot > 0 && strike > 0 && vol > 0;
  const call = ok ? blackScholes(spot, strike, years, vol, "C") : NaN;
  const put = ok ? blackScholes(spot, strike, years, vol, "P") : NaN;
  return <Panel title="Option price & break-even" note="Black-Scholes">
    <Box sx={formGrid}>
      <Field id="op-spot" label="Spot" value={form.spot} onChange={set("spot")} />
      <Field id="op-strike" label="Strike" value={form.strike} onChange={set("strike")} />
      <Field id="op-days" label="Days to expiry" value={form.days} onChange={set("days")} />
      <Field id="op-iv" label="IV %" value={form.iv} onChange={set("iv")} />
    </Box>
    {ok && <Results label="Option result" rows={[
      ["Call (CE) fair value", inr(call)], ["Put (PE) fair value", inr(put)],
      ["Call delta", blackScholesDelta(spot, strike, years, vol, "C").toFixed(2)], ["Put delta", blackScholesDelta(spot, strike, years, vol, "P").toFixed(2)],
      ["1-σ move by expiry", `± ${(spot * vol * Math.sqrt(years)).toFixed(1)} pts`],
      ["CE break-even", fp(strike + call), UP], ["PE break-even", fp(strike - put), DOWN],
    ]} />}
  </Panel>;
}

function Calendar({ snapshot }) {
  const today = todayIso();
  const holidays = Object.entries(snapshot?.holidays || {}).filter(([date]) => date >= today).sort(([a], [b]) => a.localeCompare(b));
  const rows = snapshot?.calendar || [];
  const line = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 1, py: 0.5, borderBottom: 1, borderColor: "divider", fontSize: 12.5 };
  return <Panel title="Expiry & holiday calendar" note="NSE · BSE">
    <Typography variant="caption" color="text.secondary">Upcoming expiries</Typography>
    {!rows.length && <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>Expiries appear once the contract list loads.</Typography>}
    {rows.map(row => <Box key={row.index} data-index={row.index} sx={{ py: 0.75, borderBottom: 1, borderColor: "divider" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, fontSize: 12.5 }}>
        <b>{row.index}</b><Box component="span" sx={{ color: "text.secondary" }}>{row.cycle} · lot {row.lot}</Box>
      </Box>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25, mt: 0.25, fontSize: 12, ...mono }}>
        {(row.next || []).map(date => <span key={date}>{dayLabel(date)} <Box component="span" sx={{ color: "text.secondary" }}>{daysBetween(today, date)}d</Box></span>)}
      </Box>
    </Box>)}
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.25 }}>Trading holidays (NSE & BSE)</Typography>
    {holidays.length ? holidays.map(([date, name]) => <Box key={date} sx={line}>
      <span>{dayLabel(date)} <Box component="b" sx={{ color: "warning.main" }}>{name}</Box></span>
      <Box component="span" sx={{ color: "text.secondary", ...mono }}>{daysBetween(today, date)}d</Box>
    </Box>) : <Typography variant="body2" color="text.secondary">No more holidays this year.</Typography>}
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
      Next year's holidays are added when NSE publishes its circular. Market hours: pre-open 09:00–09:15 · normal 09:15–15:30 · closing
      session 15:40–16:00. Most brokers auto square-off intraday positions from about 15:15–15:20.
    </Typography>
  </Panel>;
}

const readWatch = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCH_KEY));
    return Array.isArray(saved) && saved.length ? saved.filter(sym => typeof sym === "string") : [...DEFAULT_WATCH];
  } catch { return [...DEFAULT_WATCH]; }
};

function Watchlist({ snapshot, scan, onPick }) {
  const [list, setList] = useState(readWatch);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const save = next => { setList(next); try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ } };
  const add = event => {
    event.preventDefault();
    const sym = draft.trim().toUpperCase();
    if (!sym) return;
    if (!snapshot?.stocks?.length) { setNote("Prices are still loading. Try again in a moment."); return; }
    if (!snapshot.bySym[sym]) { setNote(`${sym} is not in the NIFTY 500 or F&O list.`); return; }
    if (list.includes(sym)) { setNote(`${sym} is already in your watchlist.`); return; }
    save([...list, sym]);
    setDraft("");
    setNote("");
  };
  const cell = { py: 0.6, borderBottom: 1, borderColor: "divider", fontSize: 12.5, minWidth: 0 };
  return <Panel title="My watchlist" note="saved in this browser">
    <Box component="form" onSubmit={add} sx={{ display: "flex", gap: 1 }}>
      <TextField id="watch-add" label="Add symbol" size="small" value={draft} placeholder="e.g. TATAMOTORS" sx={{ flex: 1 }}
        onChange={event => setDraft(event.target.value)} inputProps={{ list: "board-symbols", autoComplete: "off" }} />
      <Button type="submit" variant="contained" size="small">Add</Button>
      <datalist id="board-symbols">{(snapshot?.stocks || []).map(st => <option key={st.sym} value={st.sym} />)}</datalist>
    </Box>
    {note && <Typography role="status" variant="caption" color="warning.main" sx={{ display: "block", mt: 0.75 }}>{note}</Typography>}
    <Box role="list" aria-label="Watchlist" sx={{ mt: 1 }}>
      {!list.length && <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>Add a stock above.</Typography>}
      {list.map(sym => {
        const st = snapshot?.bySym?.[sym];
        const q = scan?.[sym];
        return <Box key={sym} role="listitem" data-sym={sym}
          sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1.1fr) auto auto auto minmax(0, 1fr) auto", gap: 1, alignItems: "center", ...cell }}>
          {st ? <NameButton st={st} onPick={onPick} /> : <b>{sym}</b>}
          {st ? <>
            <Box component="span" sx={{ ...mono, textAlign: "right" }}>{fp(st.ltp)}</Box>
            <Pct value={st.pc} sx={{ textAlign: "right" }} />
            <BuildTag code={st.b} />
            <Box component="span" sx={{ color: q?.side > 0 ? UP : q?.side < 0 ? DOWN : "text.secondary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              title={st.sector}>
              {q?.side ? `${q.side > 0 ? "▲ long" : "▼ short"} ${q.side > 0 ? q.bull : q.bear}/${q.avail}` : st.sector}
            </Box>
          </> : <Box component="span" sx={{ gridColumn: "2 / 6", color: "text.secondary" }}>{snapshot ? "not in data" : "loading…"}</Box>}
          <IconButton size="small" aria-label={`Remove ${sym}`} title="Remove" onClick={() => save(list.filter(item => item !== sym))}><X size={15} /></IconButton>
        </Box>;
      })}
    </Box>
  </Panel>;
}

export default function Tools({ api }) {
  const [pick, setPick] = useState(null);
  const { snapshot, scan, error } = useBoard(api, { scannerBars: 3, every: 10000, scannerEvery: 60000 });
  const nifty = snapshot?.idx?.NIFTY;
  const niftyDays = (snapshot?.calendar || []).find(row => row.index === "NIFTY")?.daysTo;
  return <PageShell className="tools-page">
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 0.5 }}>
      <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "1.4rem", md: "1.55rem" } }}>Tools</Typography>
      <StatusChip snapshot={snapshot} error={error} />
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Calculators for sizing, costs, levels and option prices, the expiry calendar and your watchlist.</Typography>
    <Box sx={{ display: "grid", gap: 1.5, alignItems: "start", gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" } }}>
      <PositionSize />
      <Charges />
      <Pivots nifty={nifty} />
      <OptionPrice nifty={nifty} niftyDays={niftyDays} />
      <Calendar snapshot={snapshot} />
      <Watchlist snapshot={snapshot} scan={scan} onPick={setPick} />
    </Box>
    <StockDrawer sym={pick} snapshot={snapshot} scan={scan} api={api} onClose={() => setPick(null)} />
  </PageShell>;
}
