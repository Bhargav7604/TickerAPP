import React, { useEffect, useMemo, useState } from "react";
import { Box, Checkbox, FormControlLabel, TextField, Typography } from "@mui/material";
import { INDICATORS, TIME_ZONES, cprRead, fp, fpc, inView, isNum, levelsOf, minuteClock, scanSetups, segmentLabel, sessionMinute,
  useBoard } from "../boardData";
import { BoardMessage, DOWN, Dots, FilterBar, NameButton, Panel, Pct, StatusChip, UP, toneColor, useBoardFilters } from "./boardUi";
import StockDrawer from "./stockDrawer";
import { PageShell, mono } from "../ui/Glass";

const SETTINGS_KEY = "utraders-scanner";
const DEFAULTS = { side: "both", minPct: 80, bars: 3, volume: false, liquidOnly: true };
const SHOWN = 30;
const LEVEL_INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"];
const ZONE_COLORS = { go: "success", slow: "warning", avoid: "error" };

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    return {
      side: ["both", "long", "short"].includes(saved.side) ? saved.side : DEFAULTS.side,
      minPct: [60, 70, 80, 90].includes(saved.minPct) ? saved.minPct : DEFAULTS.minPct,
      bars: [1, 3, 5].includes(saved.bars) ? saved.bars : DEFAULTS.bars,
      volume: typeof saved.volume === "boolean" ? saved.volume : DEFAULTS.volume,
      liquidOnly: typeof saved.liquidOnly === "boolean" ? saved.liquidOnly : DEFAULTS.liquidOnly,
    };
  } catch { return { ...DEFAULTS }; }
}

function useSessionMinute() {
  const [minute, setMinute] = useState(() => sessionMinute());
  useEffect(() => {
    const timer = setInterval(() => setMinute(sessionMinute()), 30000);
    return () => clearInterval(timer);
  }, []);
  return minute;
}

/** When to trade and when to sit out, with a marker for now during the session. */
function IntradayClock() {
  const now = useSessionMinute();
  const live = now >= 0 && now <= 375;
  return <Panel title="Intraday clock" note="when to trade, when to sit out" sx={{ mb: 1.5 }}>
    <Box sx={{ position: "relative", display: "flex", borderRadius: 1.5, overflow: "visible", pt: live ? 2.5 : 0 }}>
      {TIME_ZONES.map(([from, to, label, kind]) => <Box key={label} data-zone={kind} title={`${label} · ${minuteClock(from)}–${minuteClock(to)}`}
        sx={{ width: `${(to - from) / 375 * 100}%`, minWidth: 0, px: 0.75, py: 0.75, borderRight: 1, borderColor: "background.paper",
          bgcolor: theme => `${theme.palette[ZONE_COLORS[kind]].main}24`, color: `${ZONE_COLORS[kind]}.main`, overflow: "hidden" }}>
        <Typography sx={{ fontSize: 11.5, fontWeight: 800, lineHeight: 1.25, whiteSpace: { xs: "normal", md: "nowrap" }, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</Typography>
        <Typography sx={{ ...mono, fontSize: 10.5, color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{minuteClock(from)}–{minuteClock(to)}</Typography>
      </Box>)}
      {live && <Box aria-label={`Now ${minuteClock(now)}`} role="img" sx={{ position: "absolute", top: 0, bottom: 0, left: `${now / 375 * 100}%`, width: 2, bgcolor: "text.primary" }}>
        <Typography component="em" sx={{ ...mono, position: "absolute", top: 0, ...(now > 300 ? { right: 4 } : { left: 4 }), fontSize: 10.5, fontStyle: "normal", fontWeight: 800, whiteSpace: "nowrap" }}>{minuteClock(now)}</Typography>
      </Box>}
    </Box>
  </Panel>;
}

const LADDER = [["S3", "S"], ["S2", "S"], ["S1", "S"], ["P", "P"], ["R1", "R"], ["R2", "R"], ["R3", "R"]];
const GRID = ["R3", "R2", "R1", "TC", "P", "BC", "S1", "S2", "S3"];
const levelColor = name => name[0] === "R" ? DOWN : name[0] === "S" ? UP : "warning.main";

/** One index: classic pivots, CPR and Camarilla from the previous session, with where price sits now. */
function LevelCard({ ix }) {
  const ready = isNum(ix.prevH) && isNum(ix.prevL) && isNum(ix.prevC);
  const x = ix.ltp;
  let body = <Typography variant="body2" color="text.secondary">Levels appear after the daily stats load.</Typography>;
  if (ready) {
    const L = levelsOf(ix.prevH, ix.prevL, ix.prevC);
    const width = (L.TC - L.BC) / L.P * 100;
    const lo = Math.min(L.S3, isNum(x) ? x : L.S3), hi = Math.max(L.R3, isNum(x) ? x : L.R3);
    const at = value => (value - lo) / (hi - lo || 1) * 100;
    body = <>
      <Box aria-hidden="true" sx={{ position: "relative", height: 34, mt: 2.25, mb: 1, borderTop: 2, borderColor: "divider" }}>
        <Box sx={{ position: "absolute", top: -6, height: 10, left: `${at(L.BC)}%`, width: `${Math.max(at(L.TC) - at(L.BC), 0.6)}%`, bgcolor: "warning.main", opacity: 0.45, borderRadius: 0.5 }} />
        {LADDER.map(([name]) => <Box key={name} sx={{ position: "absolute", top: -7, left: `${at(L[name])}%`, transform: "translateX(-50%)", textAlign: "center" }}>
          <Box sx={{ width: 2, height: 12, mx: "auto", bgcolor: levelColor(name) }} />
          <Typography component="em" sx={{ fontSize: 10, fontStyle: "normal", fontWeight: 800, color: levelColor(name) }}>{name === "P" ? "CPR" : name}</Typography>
        </Box>)}
        {isNum(x) && <Box sx={{ position: "absolute", top: -9, left: `${at(x)}%`, transform: "translateX(-50%)", width: 14, height: 14, borderRadius: "50%",
          bgcolor: "text.primary", border: 2, borderColor: "background.paper" }} />}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, auto 1fr)", columnGap: 1, rowGap: 0.25, fontSize: 12.5 }}>
        {GRID.map(name => <React.Fragment key={name}>
          <Box component="span" sx={{ fontWeight: 800, color: levelColor(name) }}>{name}</Box>
          <Box component="span" data-level={name} sx={{ ...mono, textAlign: "right", pr: 1 }}>{fp(L[name])}</Box>
        </React.Fragment>)}
      </Box>
      <Typography sx={{ mt: 1, fontSize: 13, fontWeight: 800, color: isNum(x) ? (x > L.TC ? UP : x < L.BC ? DOWN : "warning.main") : "text.secondary" }}>
        {isNum(x) ? cprRead(L, x) : "Waiting for a price"}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
        CPR width {width.toFixed(2)}% · {width < 0.25 ? <Box component="b" sx={{ color: "warning.main" }}>narrow — trending day likely</Box>
          : width > 0.6 ? "wide — range-bound day likely" : "normal"}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", ...mono }}>
        Camarilla H3 {fp(L.H3)} · H4 {fp(L.H4)} · L3 {fp(L.L3)} · L4 {fp(L.L4)}
      </Typography>
    </>;
  }
  return <Panel title={ix.label || ix.key} actions={<Typography sx={{ ...mono, fontSize: 13, fontWeight: 800, color: toneColor(ix.pc) }}>{fp(x)} {fpc(ix.pc)}</Typography>}>
    {body}
  </Panel>;
}

function Choice({ id, label, value, onChange, options, width = 150 }) {
  return <TextField select id={id} label={label} size="small" value={value} onChange={event => onChange(event.target.value)}
    SelectProps={{ native: true }} sx={{ width }}>
    {options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
  </TextField>;
}

const cell = { px: 1, py: 0.6, borderBottom: 1, borderColor: "divider", whiteSpace: "nowrap", fontSize: 12.5 };
const num = { ...cell, ...mono, textAlign: "right" };

function ScannerTable({ setups, onPick }) {
  if (!setups.length) {
    return <Typography color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
      No stock passes the filter right now. Lower the agreement level or switch off "liquid only".
    </Typography>;
  }
  const head = ["Name", "Setup", "13 indicators", "Score", "Chg", "RSI", "Entry", "Stop", "Target", "Risk", "Sector"];
  return <Box sx={{ overflowX: "auto", maxWidth: "100%" }}>
    <Box component="table" aria-label="Intraday setups" sx={{ width: "100%", minWidth: 1040, borderCollapse: "collapse" }}>
      <thead><tr>{head.map((label, i) => <Box component="th" key={label} scope="col"
        sx={{ ...cell, fontSize: 11, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", textAlign: i >= 3 && i <= 9 ? "right" : "left" }}>{label}</Box>)}</tr></thead>
      <tbody>{setups.slice(0, SHOWN).map(({ st, q, side }) => {
        const risk = isNum(q.stop) ? Math.abs(st.ltp - q.stop) / st.ltp * 100 : NaN;
        return <tr key={st.sym} data-setup={side > 0 ? "long" : "short"}>
          <Box component="td" sx={cell}><NameButton st={st} onPick={onPick} badges /></Box>
          <Box component="td" sx={{ ...cell, fontWeight: 800, color: side > 0 ? UP : DOWN }}>{side > 0 ? "▲ LONG" : "▼ SHORT"}</Box>
          <Box component="td" sx={cell}><Dots checks={q.checks} ids={INDICATORS} /></Box>
          <Box component="td" sx={num}><b>{side > 0 ? q.bull : q.bear}</b>/{q.avail}</Box>
          <Box component="td" sx={num}><Pct value={st.pc} /></Box>
          <Box component="td" sx={num}>{isNum(q.rsi) ? q.rsi.toFixed(0) : "—"}</Box>
          <Box component="td" sx={num}>{fp(st.ltp)}</Box>
          <Box component="td" sx={{ ...num, color: DOWN }}>{fp(q.stop)}</Box>
          <Box component="td" sx={{ ...num, color: UP }}>{fp(q.target)}</Box>
          <Box component="td" sx={{ ...num, color: "text.secondary" }}>{isNum(risk) ? `${risk.toFixed(2)}%` : "—"}</Box>
          <Box component="td" sx={{ ...cell, color: "text.secondary", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{st.sector}</Box>
        </tr>;
      })}</tbody>
    </Box>
    {setups.length > SHOWN && <Typography color="text.secondary" sx={{ py: 1, textAlign: "center", fontSize: 12.5 }}>+{setups.length - SHOWN} more</Typography>}
  </Box>;
}

export default function Intraday({ api }) {
  const [settings, setSettings] = useState(readSettings);
  const [filter, setFilter] = useBoardFilters();
  const [pick, setPick] = useState(null);
  const { snapshot, scan, scanMeta, error } = useBoard(api, { scannerBars: settings.bars });
  const change = next => setSettings(previous => {
    const merged = { ...previous, ...next };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch { /* storage unavailable */ }
    return merged;
  });

  const stocks = useMemo(() => snapshot?.stocks || [], [snapshot]);
  const { setups, view } = useMemo(() => {
    const options = { side: settings.side, minPct: settings.minPct, volume: settings.volume, liquidOnly: settings.liquidOnly };
    // Picks come from every stock in the chosen cap, so the "Intraday picks" list never depends on itself.
    const all = scanSetups(stocks.filter(st => inView(st, "all", filter.cap)), scan, options);
    const picks = new Set(all.map(o => o.st.sym));
    const inside = stocks.filter(st => inView(st, filter.segment, filter.cap, picks));
    const visible = new Set(inside.map(st => st.sym));
    return { setups: all.filter(o => visible.has(o.st.sym)), view: inside };
  }, [stocks, scan, settings, filter]);

  const longs = setups.filter(o => o.side > 0).length;
  const minute = snapshot?.minute;
  const warning = snapshot?.status === "live" && isNum(minute)
    ? minute < 15 ? "Opening range still forming (till 09:30) — signals are early."
      : minute >= 330 ? "After 14:45: no fresh intraday entries; manage open trades, square off by 15:15." : ""
    : "";
  const levels = LEVEL_INDICES.map(key => snapshot?.idx?.[key]).filter(Boolean);
  const started = Object.keys(scan || {}).length > 0;

  return <PageShell className="intraday-page">
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 0.5 }}>
      <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "1.4rem", md: "1.55rem" } }}>Intraday</Typography>
      <StatusChip snapshot={snapshot} error={error} />
    </Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>When to trade, today's index levels, and stocks where most indicators agree.</Typography>
    <BoardMessage snapshot={snapshot} error={error} />
    <FilterBar filter={filter} onChange={setFilter} shown={view.length} total={stocks.length} />
    <IntradayClock />
    <Box sx={{ display: "grid", gap: 1.5, mb: 1.5, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" } }}>
      {levels.map(ix => <LevelCard key={ix.key} ix={ix} />)}
    </Box>
    <Panel title="⚡ Intraday scanner" titleColor="info.main"
      note={`${longs} long · ${setups.length - longs} short setups · ${settings.bars}-min bars · ${segmentLabel(filter.segment, filter.cap)}`}>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.25, alignItems: "center", mb: 1 }}>
        <Choice id="scan-side" label="Side" value={settings.side} onChange={side => change({ side })}
          options={[["both", "Long + short"], ["long", "Long only"], ["short", "Short only"]]} />
        <Choice id="scan-min" label="Indicators agreeing ≥" value={settings.minPct} onChange={value => change({ minPct: Number(value) })}
          options={[[60, "60%"], [70, "70%"], [80, "80%"], [90, "90%"]]} width={170} />
        <Choice id="scan-bars" label="Bars" value={settings.bars} onChange={value => change({ bars: Number(value) })}
          options={[[1, "1 min"], [3, "3 min"], [5, "5 min"]]} width={110} />
        <FormControlLabel control={<Checkbox size="small" checked={settings.volume} onChange={event => change({ volume: event.target.checked })} />}
          label="Volume must confirm" />
        <FormControlLabel control={<Checkbox size="small" checked={settings.liquidOnly} onChange={event => change({ liquidOnly: event.target.checked })} />}
          label="Liquid only (F&O or ₹25 Cr+ turnover)" />
        <Typography variant="caption" color="text.secondary">Uses the stock and cap filters at the top.</Typography>
      </Box>
      {warning && <Typography role="note" sx={{ mb: 1, px: 1.25, py: 0.75, borderRadius: 1.5, fontSize: 12.5, fontWeight: 700, color: "warning.main",
        bgcolor: theme => `${theme.palette.warning.main}1f` }}>{warning}</Typography>}
      {!started && scanMeta?.message
        ? <Typography role="status" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>{scanMeta.message}</Typography>
        : <ScannerTable setups={setups} onPick={setPick} />}
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.25, lineHeight: 1.6 }}>
        Indicators, left to right: VWAP · EMA 9/21 · Supertrend (10,3) · RSI 14 · MACD · Opening-range breakout · CPR · Previous-day high/low ·
        Volume pace · OI build-up · Relative strength vs Nifty · Position in day range · Sector money flow. Green = bullish, red = bearish,
        grey = neutral, dashed = not enough data yet. A long needs VWAP, Supertrend and EMA all bullish (the core three), the chosen share of
        all 13 bullish, and at most 1 bearish at 80%+ (2 below that); shorts mirror it. Stop = Supertrend or VWAP, whichever is nearer
        (kept between 0.3% and 2% away); target = 2 × risk. Information only, not a recommendation.
      </Typography>
    </Panel>
    <StockDrawer sym={pick} snapshot={snapshot} scan={scan} api={api} onClose={() => setPick(null)} />
  </PageShell>;
}
