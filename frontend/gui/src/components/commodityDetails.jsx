import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Dialog, DialogContent, IconButton, Paper, Stack, Typography } from "@mui/material";
import { keyframes } from "@mui/system";
import { X } from "lucide-react";
import { AreaSeries, CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import LiveChart from "./liveChart";
import CommodityInsights from "./commodityInsights";
import { CHART_TYPES } from "./marketChart";
import { COMMODITY_KEYS, MONTHS, placesFor, price, signed, signedPct, signedWhole, tone, usePoll, whole } from "../commodityData";
import { levelsOf } from "../boardData";
import { mono, Segmented } from "../ui/Glass";
import { useTheme } from "../theme";

const OVERVIEW_MS = 3000;
const HISTORY_MS = 60000;
const BOARD_MS = 3000;
const CANDLE_SIZES = [["minute", "1m"], ["5minute", "5m"], ["15minute", "15m"], ["60minute", "1h"], ["day", "1D"]];
const BUILD_COLORS = { LB: "success", SC: "success", SB: "error", LU: "error" };
const COLORS = {
  light: { background: "#ffffff", text: "#5b6579", grid: "#eef1f6", border: "#e1e7f0" },
  dark: { background: "#121a2a", text: "#97a3b8", grid: "#1a2232", border: "#212b40" },
};
const PRICE = "#4a6fe0";
const LOTS = "#d68b12";
const UP = "#1fb88a";
const DOWN = "#e5484d";
const flashUp = keyframes`from { background-color: rgba(31, 184, 138, 0.35); } to { background-color: transparent; }`;
const flashDown = keyframes`from { background-color: rgba(229, 72, 77, 0.35); } to { background-color: transparent; }`;
const istTime = seconds => new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
const dayLabel = iso => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
// International prices from TradingView's quote widget (the same embed the Market page uses).
export const INTERNATIONAL = [
  { name: "Energy", symbols: [["TVC:UKOIL", "Brent crude"], ["TVC:USOIL", "WTI crude"], ["CAPITALCOM:NATURALGAS", "Natural gas"]] },
  { name: "Metals", symbols: [["TVC:GOLD", "Gold"], ["TVC:SILVER", "Silver"], ["CAPITALCOM:COPPER", "Copper"]] },
  { name: "Currency", symbols: [["FX_IDC:USDINR", "USD/INR"], ["CAPITALCOM:DXY", "Dollar index"]] },
];
const internationalUrl = theme => "https://s.tradingview.com/embed-widget/market-quotes/?locale=en#" + encodeURIComponent(JSON.stringify({
  width: "100%", height: "100%", colorTheme: theme === "dark" ? "dark" : "light", isTransparent: true, showSymbolLogo: false,
  symbolsGroups: INTERNATIONAL.map(group => ({ name: group.name, symbols: group.symbols.map(([name, displayName]) => ({ name, displayName })) })),
}));

function Title({ children, note, actions }) {
  return <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ sm: "center" }} sx={{ mb: 1.25 }}>
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="overline" component="h2" color="text.secondary">{children}</Typography>
      {note && <Typography variant="body2" color="text.secondary">{note}</Typography>}
    </Box>
    {actions && <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">{actions}</Stack>}
  </Stack>;
}

/** Price ticks flash green or red when they change. */
function useFlashes(rows, keyOf, valueOf) {
  const previous = useRef({});
  const flashes = {};
  rows.forEach(row => {
    const key = keyOf(row), value = valueOf(row), before = previous.current[key];
    if (Number.isFinite(before) && Number.isFinite(value) && before !== value) flashes[key] = value > before ? "up" : "down";
  });
  useEffect(() => {
    rows.forEach(row => { previous.current[keyOf(row)] = valueOf(row); });
  });
  return flashes;
}
const flashSx = flash => flash ? { animation: `${flash === "up" ? flashUp : flashDown} 900ms ease-out` } : {};

// ---- market overview ---------------------------------------------------------------------------------------------
function MarketOverview({ api }) {
  const { data, error } = usePoll(signal => api.overview(signal), OVERVIEW_MS, [api]);
  const rows = (data?.commodities || []).flatMap(item => item.months);
  const flashes = useFlashes(rows, row => row.symbol, row => row.ltp);
  const columns = "minmax(110px, 1.2fr) 86px 70px 80px 52px 86px 86px";
  return <Paper component="section" aria-label="Commodity market overview" sx={{ gridArea: "compare", p: 2, minWidth: 0 }}>
    <Title note={`Current, next and far futures · net lots = lots waiting to buy minus lots waiting to sell${data?.asOf ? ` · ${istTime(data.asOf)} IST` : ""}`}>
      Market overview · MCX
    </Title>
    {(error || data?.message) && <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 1 }}>{error || data.message}</Typography>}
    {/* Two commodities side by side only when every column fits; otherwise one per row. */}
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 650px), 1fr))" }}>
      {(data?.commodities || []).map(item => {
        const current = item.months[0] || {};
        return <Box key={item.key} component="article" aria-label={`${item.label} contracts`} sx={{ p: 1.25, borderRadius: 2.5, bgcolor: "background.subtle", minWidth: 0 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.5 }}>
            <Typography component="h3" sx={{ fontWeight: 800, fontSize: 14 }}>{item.label}</Typography>
            <Typography sx={{ ...mono, fontSize: 13, fontWeight: 800, color: tone(current.change) }}>{price(current.ltp, placesFor(current.ltp))} {signedPct(current.changePct)}</Typography>
          </Stack>
          <Box role="table" aria-label={`${item.label} futures`} sx={{ overflowX: "auto" }}>
            <Box role="row" sx={{ display: "grid", gridTemplateColumns: columns, gap: 1, minWidth: 620, fontSize: 10.5, fontWeight: 700, color: "text.secondary", textTransform: "uppercase", py: 0.25 }}>
              {["Contract", "LTP", "Chg %", "Net lots", "D/S", "OI", "Volume"].map((label, i) => <Box key={label} component="span" role="columnheader" sx={{ textAlign: i ? "right" : "left" }}>{label}</Box>)}
            </Box>
            {item.months.map(row => <Box key={row.symbol} role="row" sx={{ display: "grid", gridTemplateColumns: columns, gap: 1, minWidth: 620, py: 0.45, borderTop: 1, borderColor: "divider", fontSize: 12.5, alignItems: "center" }}>
              <Box component="span" role="cell" sx={{ minWidth: 0 }}>
                <Box component="b" sx={{ textTransform: "capitalize" }}>{row.month}</Box>
                <Box component="span" sx={{ ml: 0.75, color: "text.secondary", fontSize: 11 }}>{dayLabel(row.expiry)}</Box>
              </Box>
              <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", borderRadius: 1, ...flashSx(flashes[row.symbol]) }} key={`${row.symbol}-${row.ltp}`}>{price(row.ltp, placesFor(row.ltp))}</Box>
              <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", color: tone(row.changePct) }}>{signedPct(row.changePct)}</Box>
              <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", fontWeight: 800, color: tone(row.netLots) }}>{signedWhole(row.netLots)}</Box>
              <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", color: tone(row.demandSupply ? row.demandSupply - 1 : null) }}>{Number.isFinite(row.demandSupply) ? row.demandSupply.toFixed(2) : "--"}</Box>
              <Box component="span" role="cell" sx={{ ...mono, textAlign: "right" }}>{whole(row.oi)}</Box>
              <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", color: "text.secondary" }}>{whole(row.volume)}</Box>
            </Box>)}
          </Box>
        </Box>;
      })}
    </Box>
  </Paper>;
}

// ---- net lots vs price -------------------------------------------------------------------------------------------
function PriceLotsChart({ points, candles, type, label }) {
  const box = useRef(null);
  const chart = useRef(null);
  const series = useRef([]);
  const { theme } = useTheme();
  useEffect(() => {
    chart.current = createChart(box.current, {
      autoSize: true, layout: { background: { type: ColorType.Solid, color: COLORS.light.background }, textColor: COLORS.light.text, fontFamily: "inherit" },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 2 }, leftPriceScale: { visible: true },
      localization: { timeFormatter: istTime }, handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    chart.current.applyOptions?.({ timeScale: { tickMarkFormatter: istTime } });
    return () => { chart.current.remove(); chart.current = null; series.current = []; };
  }, []);
  useEffect(() => {
    const colors = COLORS[theme] || COLORS.light;
    chart.current.applyOptions?.({ layout: { background: { type: ColorType.Solid, color: colors.background }, textColor: colors.text },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } } });
  }, [theme]);
  useEffect(() => {
    series.current.forEach(item => chart.current.removeSeries?.(item));
    series.current = [];
    const add = (kind, options, data) => {
      const item = chart.current.addSeries(kind, options);
      item.setData(data);
      series.current.push(item);
    };
    const priced = points.filter(point => Number.isFinite(point.price));
    if (type === "candles" && candles.length) {
      add(CandlestickSeries, { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, borderVisible: false, priceScaleId: "right" },
        candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    } else if (type === "area") {
      add(AreaSeries, { lineColor: PRICE, topColor: "rgba(74,111,224,0.28)", bottomColor: "rgba(74,111,224,0.02)", priceScaleId: "right" },
        priced.map(point => ({ time: point.time, value: point.price })));
    } else {
      add(LineSeries, { color: PRICE, lineWidth: 2, priceScaleId: "right" }, priced.map(point => ({ time: point.time, value: point.price })));
    }
    const lots = points.filter(point => Number.isFinite(point.netLots));
    if (type === "columns") {
      add(HistogramSeries, { priceScaleId: "left" }, lots.map(point => ({ time: point.time, value: point.netLots, color: point.netLots >= 0 ? UP : DOWN })));
    } else {
      add(LineSeries, { color: LOTS, lineWidth: 2, priceScaleId: "left" }, lots.map(point => ({ time: point.time, value: point.netLots })));
    }
    chart.current.timeScale().fitContent?.();
  }, [points, candles, type]);
  return <Box ref={box} role="img" aria-label={`${label} net lots against price`} sx={{ position: "absolute", inset: 0 }} />;
}

function NetLotsPanel({ api }) {
  const [key, setKey] = useState("crudeoil");
  const [month, setMonth] = useState("current");
  const [type, setType] = useState("line");
  const history = usePoll(signal => api.history(key, month, signal), HISTORY_MS, [api, key, month]);
  const symbol = history.data?.key === key && history.data?.month === month ? history.data.symbol : null;
  const candles = usePoll(signal => symbol && type === "candles" ? api.candles(symbol, "5minute", signal) : Promise.resolve(null), HISTORY_MS, [api, symbol, type]);
  const current = history.data?.key === key && history.data?.month === month ? history.data : null;
  const points = useMemo(() => current?.points || [], [current]);
  const candleData = type === "candles" ? candles.data : null;
  const candleRows = useMemo(() => candleData?.candles || [], [candleData]);
  const latest = points[points.length - 1];
  const label = (COMMODITY_KEYS.find(([value]) => value === key) || [])[1];
  return <Paper component="section" aria-label="Commodity net lots vs price" sx={{ gridArea: "chart", p: 2, minWidth: 0 }}>
    <Title note="Every five minutes while MCX trades · price on the right, net lots on the left"
      actions={<Segmented label="Chart type" value={type} onChange={setType} options={CHART_TYPES} />}>
      {label} · Net lots vs price
    </Title>
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1 }}>
      {/* Six commodities do not fit a phone's width: the picker scrolls sideways inside its own row. */}
      <Box sx={{ maxWidth: "100%", overflowX: "auto", pb: 0.25 }}><Segmented label="Commodity" value={key} onChange={setKey} options={COMMODITY_KEYS} highlight /></Box>
      <Segmented label="Contract month" value={month} onChange={setMonth} options={MONTHS} />
    </Stack>
    {latest && <Typography variant="body2" sx={{ mb: 1 }}>
      <Box component="b" sx={{ ...mono }}>{price(latest.price, placesFor(latest.price))}</Box>
      <Box component="span" sx={{ color: "text.secondary" }}> · net lots </Box>
      <Box component="b" sx={{ ...mono, color: tone(latest.netLots) }}>{signedWhole(latest.netLots)}</Box>
      <Box component="span" sx={{ color: "text.secondary" }}> · {istTime(latest.time)} IST · {history.data.symbol}</Box>
    </Typography>}
    <Box sx={{ position: "relative", height: { xs: 280, md: 340 }, borderRadius: 2, overflow: "hidden", border: 1, borderColor: "divider" }}>
      <PriceLotsChart points={points} candles={candleRows} type={type} label={label} />
      {!points.length && <Typography role="status" color="text.secondary" sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", px: 2, textAlign: "center", fontSize: 13, pointerEvents: "none" }}>
        {history.error || history.data?.message || "Loading net lots…"}
      </Typography>}
    </Box>
  </Paper>;
}

// ---- international prices ----------------------------------------------------------------------------------------
function InternationalPrices() {
  const { theme } = useTheme();
  return <Paper component="section" aria-label="International prices" sx={{ gridArea: "activity", p: 2, minWidth: 0, display: "flex", flexDirection: "column" }}>
    <Title note="Brent, WTI, COMEX metals and the rupee from TradingView">International prices</Title>
    <Box sx={{ position: "relative", flex: 1, minHeight: 380 }}>
      <Box component="iframe" key={theme} title="International commodity prices from TradingView" src={internationalUrl(theme)} loading="lazy"
        sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
    </Box>
  </Paper>;
}

// ---- every MCX future --------------------------------------------------------------------------------------------
function ContractChart({ row, api, onClose }) {
  const [interval, setCandleSize] = useState("5minute");
  const { data } = usePoll(signal => api.candles(row.symbol, interval, signal), HISTORY_MS, [api, row.symbol, interval]);
  const levels = Number.isFinite(row.prevHigh) && Number.isFinite(row.prevLow) && Number.isFinite(row.prevSessionClose)
    ? levelsOf(row.prevHigh, row.prevLow, row.prevSessionClose) : null;
  const places = placesFor(row.ltp);
  const facts = [["Prev close", price(row.prevClose, places)], ["Open", price(row.open, places)], ["High / low", `${price(row.high, places)} / ${price(row.low, places)}`],
    ["VWAP", price(row.vwap, places)], ["OI", `${whole(row.oi)} (${signedPct(row.oiChangePct)})`], ["Volume", whole(row.volume)],
    ["Circuit", `${price(row.lc, places)} – ${price(row.uc, places)}`], ["Expiry", `${dayLabel(row.expiry)} · ${row.daysToExpiry}d`]];
  return <Dialog open onClose={onClose} fullWidth maxWidth="md" PaperProps={{ "aria-label": `${row.label} chart` }}>
    <DialogContent>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box>
          <Typography component="h2" sx={{ fontSize: 20, fontWeight: 850 }}>{row.label}</Typography>
          <Typography variant="caption" color="text.secondary">MCX:{row.symbol}{row.unit ? ` · quoted ${row.unit}` : ""}</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography sx={{ ...mono, fontSize: 20, fontWeight: 850 }}>{price(row.ltp, places)}</Typography>
          <Typography sx={{ ...mono, fontWeight: 800, color: tone(row.change) }}>{signed(row.change, places)} ({signedPct(row.changePct)})</Typography>
          <IconButton aria-label="Close chart" onClick={onClose} size="small"><X size={18} /></IconButton>
        </Stack>
      </Stack>
      <Box sx={{ my: 1 }}><Segmented label="Candle size" value={interval} onChange={setCandleSize} options={CANDLE_SIZES} /></Box>
      <Box sx={{ position: "relative", height: 320, borderRadius: 2, overflow: "hidden", border: 1, borderColor: "divider" }}>
        <LiveChart candles={data?.candles || []} live={{ ltp: row.ltp, tradedAt: row.tradedAt }} interval={interval} precision={places} label={row.label} />
        {!data?.candles?.length && <Typography role="status" color="text.secondary" sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13, pointerEvents: "none" }}>
          {data?.message || "Loading chart…"}</Typography>}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 1.25, mt: 1.5 }}>
        {facts.map(([name, value]) => <Box key={name}><Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>{name}</Typography>
          <Typography sx={{ ...mono, fontSize: 13, fontWeight: 700 }}>{value}</Typography></Box>)}
      </Box>
      {levels && <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, ...mono }}>
        Pivots from the previous session · R2 {price(levels.R2, places)} · R1 {price(levels.R1, places)} · P {price(levels.P, places)} · S1 {price(levels.S1, places)} · S2 {price(levels.S2, places)}
      </Typography>}
    </DialogContent>
  </Dialog>;
}

function CommodityBoard({ api }) {
  const [month, setMonth] = useState("near");
  const [open, setOpen] = useState(null);
  const { data, error } = usePoll(signal => api.board(month, signal), BOARD_MS, [api, month]);
  const rows = data?.month === month ? data.rows || [] : [];
  const flashes = useFlashes(rows, row => row.symbol, row => row.ltp);
  const columns = "minmax(150px, 1.6fr) 92px 96px 70px 92px 92px 84px 96px 70px 48px";
  const groups = (data?.groups || []).map(group => [group, rows.filter(row => row.group === group)]).filter(([, list]) => list.length);
  const selected = open && rows.find(row => row.symbol === open);
  const session = data?.session;
  return <Paper component="section" aria-label="All MCX futures" sx={{ gridArea: "acdd", p: 2, minWidth: 0 }}>
    <Title note={`${session ? (session.open ? `MCX open · closes ${session.closesAt} IST` : `MCX closed · opens ${session.opensAt} IST`) : "Loading…"}${data?.asOf ? ` · ${istTime(data.asOf)} IST` : ""} · click a commodity for its chart`}
      actions={<Segmented label="Contract" value={month} onChange={setMonth} options={[["near", "Near month"], ["next", "Next month"]]} />}>
      All MCX futures
    </Title>
    {(error || data?.message) && <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 1 }}>{error || data.message}</Typography>}
    <Box role="table" aria-label="MCX futures" sx={{ overflowX: "auto" }}>
      <Box role="row" sx={{ display: "grid", gridTemplateColumns: columns, gap: 1, minWidth: 960, fontSize: 10.5, fontWeight: 700, color: "text.secondary", textTransform: "uppercase", pb: 0.5 }}>
        {["Commodity", "LTP", "Change", "Chg %", "High", "Low", "Volume", "OI", "OI chg", "Build"].map((label, i) =>
          <Box key={label} component="span" role="columnheader" sx={{ textAlign: i ? "right" : "left" }}>{label}</Box>)}
      </Box>
      {groups.map(([group, list]) => <React.Fragment key={group}>
        <Typography role="row" sx={{ minWidth: 960, mt: 1, mb: 0.25, fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: "primary.main" }}>
          <span role="cell">{group}</span>
        </Typography>
        {list.map(row => {
          const places = placesFor(row.ltp);
          return <Box key={row.symbol} role="row" tabIndex={0} onClick={() => setOpen(row.symbol)} onKeyDown={event => { if (event.key === "Enter") setOpen(row.symbol); }}
            aria-label={`${row.label} ${price(row.ltp, places)} ${signedPct(row.changePct)}`}
            sx={{ display: "grid", gridTemplateColumns: columns, gap: 1, minWidth: 960, py: 0.55, px: 0.25, borderTop: 1, borderColor: "divider", fontSize: 12.5,
              alignItems: "center", cursor: "pointer", borderRadius: 1, "&:hover, &:focus-visible": { bgcolor: "action.hover", outline: "none" } }}>
            <Box component="span" role="cell" sx={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <b>{row.label}</b>
              <Box component="span" sx={{ ml: 0.75, color: "text.secondary", fontSize: 11 }}>{dayLabel(row.expiry)}{row.unit ? ` · ${row.unit}` : ""}</Box>
            </Box>
            <Box component="span" role="cell" key={`${row.symbol}-${row.ltp}`} sx={{ ...mono, textAlign: "right", fontWeight: 800, borderRadius: 1, ...flashSx(flashes[row.symbol]) }}>{price(row.ltp, places)}</Box>
            <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", color: tone(row.change) }}>{signed(row.change, places)}</Box>
            <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", color: tone(row.changePct), fontWeight: 700 }}>{signedPct(row.changePct)}</Box>
            <Box component="span" role="cell" sx={{ ...mono, textAlign: "right" }}>{price(row.high, places)}</Box>
            <Box component="span" role="cell" sx={{ ...mono, textAlign: "right" }}>{price(row.low, places)}</Box>
            <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", color: "text.secondary" }}>{whole(row.volume)}</Box>
            <Box component="span" role="cell" sx={{ ...mono, textAlign: "right" }}>{whole(row.oi)}</Box>
            <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", color: tone(row.oiChangePct) }}>{signedPct(row.oiChangePct)}</Box>
            <Box component="span" role="cell" sx={{ textAlign: "right" }}>
              {row.buildup && <Box component="span" title={row.buildup} sx={{ px: 0.6, borderRadius: 1, fontSize: 10.5, fontWeight: 800, color: `${BUILD_COLORS[row.buildup]}.main`,
                bgcolor: t => `${t.palette[BUILD_COLORS[row.buildup]].main}1f` }}>{row.buildup}</Box>}
            </Box>
          </Box>;
        })}
      </React.Fragment>)}
    </Box>
    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
      Build: LB long build-up (price ▲ OI ▲) · SB short build-up (price ▼ OI ▲) · SC short covering (price ▲ OI ▼) · LU long unwinding (price ▼ OI ▼), against the previous session's open interest.
    </Typography>
    {selected && <ContractChart row={selected} api={api} onClose={() => setOpen(null)} />}
  </Paper>;
}

/** The commodity counterpart of Home's market tables and charts, placed in the same grid areas. */
export default function CommodityDetails({ api }) {
  return <>
    <CommodityInsights api={api} />
    <MarketOverview api={api} />
    <NetLotsPanel api={api} />
    <InternationalPrices />
    <CommodityBoard api={api} />
  </>;
}
