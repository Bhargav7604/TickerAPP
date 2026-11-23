import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { BellRing, X } from "lucide-react";
import { createChart, ColorType, LineSeries } from "lightweight-charts";
import { timeLabel } from "../oiData";
import { alertHit, changeSinceOpen, DEFAULT_LINES, INDICES, LINES, sampleEvery, TABLE_ORDER } from "../straddleData";
import { withArrow } from "../trend";
import { useTheme } from "../theme";
import { Panel, Tag, toneColor } from "./boardUi";
import { Segmented, mono } from "../ui/Glass";

const LIVE_MS = 5000;
const IDLE_MS = 60000;
const RETRY_MS = 15000;
const PREFS_KEY = "utraders-straddle";
const CHART_COLORS = {
  light: { background: "#ffffff", text: "#5b6579", grid: "#eef1f6", border: "#e1e7f0", alert: "#3653d4" },
  dark: { background: "#0e1320", text: "#95a1b7", grid: "#1a2232", border: "#212b40", alert: "#86abf4" },
};
const LINE_COLOR = Object.fromEntries(LINES.map(([key, , color]) => [key, color]));
const LINE_LABEL = Object.fromEntries(LINES.map(([key, label]) => [key, label]));

const money = value => Number.isFinite(value) ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--";
const strikeText = value => Number.isFinite(value) ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "--";
const signed = value => `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value))}`;
const dateText = iso => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) : "";

function readPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    return {
      index: INDICES.some(([key]) => key === saved.index) ? saved.index : "nifty",
      lines: Array.isArray(saved.lines) && saved.lines.every(key => LINE_COLOR[key]) ? saved.lines : DEFAULT_LINES,
      interval: [3, 15].includes(saved.interval) ? saved.interval : 3,
      layout: ["both", "chart", "table"].includes(saved.layout) ? saved.layout : "both",
    };
  } catch { return { index: "nifty", lines: DEFAULT_LINES, interval: 3, layout: "both" }; }
}

/** A short rising tone; browsers without audio stay silent. */
function beep() {
  try {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    const tone = context.createOscillator(), volume = context.createGain();
    tone.frequency.value = 880; volume.gain.value = 0.15;
    tone.connect(volume); volume.connect(context.destination);
    tone.start(); tone.stop(context.currentTime + 0.6);
    tone.onended = () => context.close();
  } catch { /* no audio */ }
}

/** The day's straddle and strangle lines; zoom and scroll survive each refresh, and a new index or day refits. */
function StraddleChart({ series, visible, alertLevel, fitKey, label }) {
  const box = useRef(null);
  const chart = useRef(null);
  const lines = useRef({});
  const alertLine = useRef(null);
  const fitted = useRef("");
  const [hover, setHover] = useState(null);
  const { theme } = useTheme();
  const seriesRef = useRef(series); seriesRef.current = series;

  useEffect(() => {
    if (!box.current) return undefined;
    const colors = CHART_COLORS[theme] || CHART_COLORS.light;
    const made = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.text, attributionLogo: true,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      rightPriceScale: { borderColor: colors.border },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: colors.border, tickMarkFormatter: timeLabel },
      localization: { timeFormatter: timeLabel, priceFormatter: money },
    });
    lines.current = Object.fromEntries(LINES.map(([key, , color]) => [key, made.addSeries(LineSeries, {
      color, lineWidth: key === "ATM" ? 3 : 2, priceLineVisible: false, lastValueVisible: key === "ATM", crosshairMarkerRadius: 3 })]));
    made.subscribeCrosshairMove(event => {
      const index = event.time ? seriesRef.current?.times.indexOf(event.time) : -1;
      setHover(index >= 0 ? index : null);
    });
    chart.current = made;
    fitted.current = "";
    alertLine.current = null;
    return () => { chart.current = null; lines.current = {}; made.remove(); };
  }, [theme]);

  useEffect(() => {
    if (!chart.current || !series) return;
    LINES.forEach(([key]) => {
      const line = lines.current[key];
      line.setData(series.times.map((time, index) => Number.isFinite(series.lines[key]?.[index]) ? { time, value: series.lines[key][index] } : { time }));
      line.applyOptions({ visible: visible.includes(key) });
    });
    if (fitted.current !== fitKey) { chart.current.timeScale().fitContent(); fitted.current = fitKey; }
  }, [series, visible, fitKey, theme]);

  useEffect(() => {
    const atm = lines.current.ATM;
    if (!atm) return;
    if (alertLine.current) { atm.removePriceLine(alertLine.current); alertLine.current = null; }
    if (Number.isFinite(alertLevel)) {
      const colors = CHART_COLORS[theme] || CHART_COLORS.light;
      alertLine.current = atm.createPriceLine({ price: alertLevel, color: colors.alert, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "Alert" });
    }
  }, [alertLevel, theme]);

  const at = hover ?? (series?.times.length ? series.times.length - 1 : null);
  return <Box sx={{ position: "relative" }}>
    <Box aria-live="polite" sx={{ display: "flex", flexWrap: "wrap", gap: "2px 12px", mb: 1, fontSize: 12.5, minHeight: 20 }}>
      {at !== null && series && <>
        <Box component="span" sx={{ ...mono, color: "text.secondary" }}>{timeLabel(series.times[at])} IST</Box>
        {LINES.filter(([key]) => visible.includes(key)).map(([key, name, color]) => <Box component="span" key={key} sx={{ ...mono, color }}>
          {name} <b>{money(series.lines[key]?.[at])}</b>
        </Box>)}
      </>}
    </Box>
    <Box ref={box} role="img" aria-label={label} sx={{ height: { xs: 300, md: 400 } }} />
  </Box>;
}

function Stat({ label, children, sx }) {
  return <Box sx={{ minWidth: 0, ...sx }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", fontSize: 10.5 }}>{label}</Typography>
    <Box sx={{ ...mono, fontWeight: 800, fontSize: 16, mt: 0.25 }}>{children}</Box>
  </Box>;
}

function Ladder({ rows }) {
  const byKey = Object.fromEntries((rows || []).map(row => [row.key, row]));
  return <Box component="table" aria-label="Straddle and strangle prices" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 13,
    "& th": { textAlign: "right", fontSize: 11, fontWeight: 800, color: "text.secondary", textTransform: "uppercase", letterSpacing: 0.4, px: 1, py: 0.75, borderBottom: 1, borderColor: "divider" },
    "& td": { ...mono, textAlign: "right", px: 1, py: 0.7, borderBottom: 1, borderColor: "divider", whiteSpace: "nowrap" },
    "& th:first-of-type, & td:first-of-type": { textAlign: "left" } }}>
    <thead><tr>{["Strikes out", "CE strike", "CE", "PE strike", "PE", "Total"].map(head => <th key={head} scope="col">{head}</th>)}</tr></thead>
    <tbody>{TABLE_ORDER.map(key => {
      const row = byKey[key] || {};
      const atm = key === "ATM";
      return <Box component="tr" key={key} data-line={key} aria-current={atm ? "true" : undefined}
        sx={{ bgcolor: theme => atm ? alpha(theme.palette.warning.main, 0.16) : "transparent", "& td": { fontWeight: atm ? 800 : 500 } }}>
        <Box component="td" sx={{ fontFamily: "inherit !important" }}>
          <Box component="span" sx={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", bgcolor: LINE_COLOR[key], mr: 0.75 }} />{LINE_LABEL[key]}
        </Box>
        <td>{strikeText(row.ceStrike)}</td><td>{money(row.ce)}</td><td>{strikeText(row.peStrike)}</td><td>{money(row.pe)}</td>
        <Box component="td" sx={{ color: atm ? "error.main" : "text.primary", fontWeight: "800 !important" }}>{money(row.total)}</Box>
      </Box>;
    })}</tbody>
  </Box>;
}

export default function StraddleView({ api }) {
  const [prefs, setPrefs] = useState(readPrefs);
  const [expiries, setExpiries] = useState([]);
  const [expiry, setExpiry] = useState("");
  const [day, setDay] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [alert, setAlert] = useState({ direction: "above", level: "", sound: true, armed: false });
  const [fired, setFired] = useState("");
  const update = change => setPrefs(previous => {
    const next = { ...previous, ...change };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });

  useEffect(() => {
    const abort = new AbortController();
    setExpiries([]); setExpiry(""); setDay(""); setData(null); setError("");
    api.expiries(prefs.index, abort.signal).then(result => {
      setExpiries(result.expiries || []);
      setExpiry((result.recorded?.[0]) || (result.expiries || [])[0] || "");
      if (!(result.expiries || []).length) setError("No expiries are listed for this index.");
    }).catch(exc => { if (exc.name !== "AbortError") setError(exc.message); });
    return () => abort.abort();
  }, [api, prefs.index]);

  useEffect(() => {
    if (!expiry) return undefined;
    let stopped = false, timer;
    const abort = new AbortController();
    const run = async () => {
      let wait = LIVE_MS;
      if (document.visibilityState !== "hidden") {
        try {
          const result = await api.load(prefs.index, expiry, day, abort.signal);
          if (stopped) return;
          setData(result); setError(""); setNow(Date.now());
          wait = result.live ? LIVE_MS : IDLE_MS;
        } catch (exc) {
          if (stopped || exc.name === "AbortError") return;
          setError(exc.message); wait = RETRY_MS;
        }
      }
      if (!stopped) timer = setTimeout(run, wait);
    };
    run();
    return () => { stopped = true; abort.abort(); clearTimeout(timer); };
  }, [api, prefs.index, expiry, day]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const current = data?.current;
  const atmRow = current?.rows?.find(row => row.key === "ATM");
  const move = changeSinceOpen(data?.series, current);
  const shown = useMemo(() => sampleEvery(data?.series, prefs.interval), [data, prefs.interval]);
  const level = alert.level === "" ? NaN : Number(alert.level);

  useEffect(() => {
    if (!alertHit({ ...alert, level }, atmRow?.total)) return;
    setFired(`${data.label} straddle ${money(atmRow.total)} went ${alert.direction} ${money(level)} at ${timeLabel(current.at)} IST.`);
    setAlert(previous => ({ ...previous, armed: false }));
    if (alert.sound) beep();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleLine = key => update({ lines: prefs.lines.includes(key) ? prefs.lines.filter(item => item !== key) : [...prefs.lines, key] });
  const allOn = prefs.lines.length === LINES.length;
  const age = current ? Math.max(0, Math.round(now / 1000 - current.at)) : null;
  const select = (label, value, onChange, options, minWidth = 130) => <TextField select size="small" value={value} onChange={event => onChange(event.target.value)}
    SelectProps={{ inputProps: { "aria-label": label } }} sx={{ minWidth, "& .MuiInputBase-root": { fontSize: 13 } }}>
    {options.map(([key, text]) => <MenuItem key={key} value={key}>{text}</MenuItem>)}
  </TextField>;

  return <Box component="section" aria-label="Straddles" sx={{ px: { xs: 1.5, sm: 2.5 }, pb: { xs: 11, md: 4 }, pt: 1 }}>
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", mb: 1.5 }}>
      {select("Straddle index", prefs.index, value => update({ index: value }), INDICES, 140)}
      {select("Straddle expiry", expiry, value => { setExpiry(value); setDay(""); }, expiries.map(item => [item, dateText(item)]), 160)}
      {data?.days?.length > 1 && select("Straddle day", day || data.day, value => setDay(value === data.days[0] ? "" : value),
        data.days.map((item, index) => [item, index === 0 ? `${dateText(item)} (latest)` : dateText(item)]), 170)}
      <Segmented label="Interval" value={prefs.interval} onChange={value => update({ interval: value })} options={[[3, "3 min"], [15, "15 min"]]} />
      <Segmented label="Layout" value={prefs.layout} onChange={value => update({ layout: value })} options={[["both", "Chart + table"], ["chart", "Chart"], ["table", "Table"]]} />
    </Box>

    <Box component="form" aria-label="Straddle alert" onSubmit={event => { event.preventDefault(); if (Number.isFinite(level)) { setAlert(previous => ({ ...previous, armed: true })); setFired(""); } }}
      sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", mb: 1.5 }}>
      <BellRing size={16} aria-hidden="true" />
      <Typography variant="body2" sx={{ fontWeight: 700 }}>Alert when the ATM straddle goes</Typography>
      {select("Alert direction", alert.direction, value => setAlert(previous => ({ ...previous, direction: value, armed: false })), [["above", "above"], ["below", "below"]], 100)}
      <TextField size="small" value={alert.level} onChange={event => setAlert(previous => ({ ...previous, level: event.target.value.replace(/[^0-9.]/g, ""), armed: false }))}
        placeholder="Level" inputProps={{ "aria-label": "Alert level", inputMode: "decimal" }} sx={{ width: 110, "& input": { ...mono } }} />
      <FormControlLabel control={<Checkbox size="small" checked={alert.sound} onChange={event => setAlert(previous => ({ ...previous, sound: event.target.checked }))} />}
        label="Sound" sx={{ mr: 0, "& .MuiFormControlLabel-label": { fontSize: 13 } }} />
      {alert.armed
        ? <Button size="small" variant="outlined" onClick={() => setAlert(previous => ({ ...previous, armed: false }))}>Cancel alert</Button>
        : <Button size="small" variant="contained" type="submit" disabled={!Number.isFinite(level)}>Set alert</Button>}
      {alert.armed && <Tag color="primary">Watching for {alert.direction} {money(level)}</Tag>}
    </Box>
    {fired && <Box role="alert" sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, px: 1.5, py: 1, borderRadius: 2, bgcolor: theme => alpha(theme.palette.warning.main, 0.16) }}>
      <BellRing size={16} aria-hidden="true" /><Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>{fired}</Typography>
      <Button size="small" onClick={() => setFired("")} startIcon={<X size={14} />}>Dismiss</Button>
    </Box>}

    {error && <Typography role="alert" variant="body2" sx={{ mb: 1.5, px: 1.5, py: 1, borderRadius: 2, bgcolor: "action.hover", color: "text.secondary" }}>{error}</Typography>}
    {!data && !error && <Typography role="status" variant="body2" color="text.secondary">Loading straddles…</Typography>}
    {data?.message && <Typography role="status" variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{data.message}</Typography>}

    {current && <Panel aria-label="Straddle summary" sx={{ mb: 1.5 }}>
      <Box sx={{ display: "grid", gap: 1.5, alignItems: "center", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr)) minmax(0, 1.6fr) repeat(2, minmax(0, 1fr))" } }}>
        <Stat label="Spot">{money(current.spot)}</Stat>
        <Stat label="Synthetic future">{money(current.synthetic)}</Stat>
        <Stat label="ATM strike">{strikeText(current.atm)}</Stat>
        <Stat label="ATM CE · PE"><Box component="span" sx={{ color: "success.main" }}>{money(atmRow?.ce)}</Box> · <Box component="span" sx={{ color: "error.main" }}>{money(atmRow?.pe)}</Box></Stat>
        <Box sx={{ gridColumn: { xs: "1 / -1", lg: "auto" }, px: 1.5, py: 1, borderRadius: 2, bgcolor: theme => alpha(theme.palette.primary.main, 0.08) }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", fontSize: 10.5 }}>Straddle price</Typography>
          <Box data-testid="straddle-price" sx={{ ...mono, fontSize: 26, fontWeight: 800, lineHeight: 1.2 }}>{money(atmRow?.total)}</Box>
          {move && <Box sx={{ ...mono, fontSize: 12.5, color: toneColor(move.change) }}>
            {withArrow(move.change, `${signed(move.change)}${Number.isFinite(move.pct) ? ` (${move.pct > 0 ? "+" : move.pct < 0 ? "−" : ""}${Math.abs(move.pct).toFixed(1)}%)` : ""}`)} since {timeLabel(move.since)}
          </Box>}
        </Box>
        <Stat label="Days to expiry">{data.dte}</Stat>
        <Stat label={data.live ? "Last updated" : "Recorded at"}>
          {data.live ? `${age}s ago` : timeLabel(current.at)} <Tag color={data.live ? "success" : "default"} sx={{ ml: 0.5 }}>{data.live ? "LIVE" : "RECORDED"}</Tag>
        </Stat>
      </Box>
    </Panel>}

    {current && <Box sx={{ display: "grid", gap: 1.5, alignItems: "start",
      gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: prefs.layout === "both" ? "minmax(0, 1.9fr) minmax(360px, 1fr)" : "minmax(0, 1fr)" } }}>
      {prefs.layout !== "table" && <Panel title={`${data.label} straddle & strangles`} note={`${dateText(data.day)} · ${prefs.interval} min`}>
        <Box role="group" aria-label="Lines shown" sx={{ display: "flex", flexWrap: "wrap", gap: "0 4px", mb: 0.5 }}>
          <FormControlLabel label="All" sx={{ mr: 1, "& .MuiFormControlLabel-label": { fontSize: 13, fontWeight: 700 } }}
            control={<Checkbox size="small" checked={allOn} indeterminate={!allOn && prefs.lines.length > 0}
              onChange={() => update({ lines: allOn ? ["ATM"] : LINES.map(([key]) => key) })} />} />
          {LINES.map(([key, name, color]) => <FormControlLabel key={key} label={name} sx={{ mr: 1, "& .MuiFormControlLabel-label": { fontSize: 13, fontWeight: 700, color } }}
            control={<Checkbox size="small" checked={prefs.lines.includes(key)} onChange={() => toggleLine(key)} sx={{ color, "&.Mui-checked": { color } }} />} />)}
        </Box>
        <StraddleChart series={shown} visible={prefs.lines} alertLevel={alert.armed ? level : NaN} fitKey={`${data.index}|${data.expiry}|${data.day}|${prefs.interval}`}
          label={`${data.label} straddle and strangle prices on ${dateText(data.day)}, ${shown.times.length} points`} />
      </Panel>}
      {prefs.layout !== "chart" && <Panel title="Strikes" note={`ATM ${strikeText(current.atm)}`}><Ladder rows={current.rows} /></Panel>}
    </Box>}
    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5, lineHeight: 1.6 }}>
      ATM is the strike nearest the synthetic future (strike + call − put). OTM n adds the call n strikes above ATM to the put n strikes below;
      ITM 1 pairs the call one strike below with the put one strike above. Prices are recorded every 3 minutes, with live quotes
      added while the market is open and Zerodha is connected.
    </Typography>
  </Box>;
}
