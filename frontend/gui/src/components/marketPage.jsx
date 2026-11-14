import React, { useEffect, useMemo, useRef, useState } from "react";
import { Autocomplete, Box, Chip, TextField, Typography } from "@mui/material";
import { MOVERS, breadthGroups, capRead, contributions, fp, fpc, moodScore, sectorFlow, FLOW_TAGS, useBoard } from "../boardData";
import { BoardMessage, NameButton, Panel, Pct, StatusChip, UP, DOWN } from "./boardUi";
import StockDrawer from "./stockDrawer";
import { mono, PageShell } from "../ui/Glass";
import { useTheme } from "../theme";

const INDEX_CARDS = ["NIFTY", "SENSEX", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "NIFTY500", "INDIAVIX"];
const FLOW_SECTOR_KEY = "utraders-flow-sector";
// Global markets come from TradingView's quote widget; Zerodha does not carry them. Exchange index feeds (TVC:NI225,
// TVC:DXY, GIFT Nifty) are blank in free embeds, so the broker CFD quotes stand in; checked in the widget on 14 Nov 2026.
export const GLOBAL_GROUPS = [
  { name: "US (overnight)", symbols: [["CAPITALCOM:US30", "Dow Jones"], ["CAPITALCOM:US500", "S&P 500"], ["CAPITALCOM:US100", "Nasdaq 100"]] },
  { name: "Asia", symbols: [["CAPITALCOM:J225", "Nikkei 225"], ["CAPITALCOM:HK50", "Hang Seng"], ["CAPITALCOM:CN50", "China A50"]] },
  { name: "Europe", symbols: [["CAPITALCOM:UK100", "FTSE 100"], ["CAPITALCOM:DE40", "DAX"]] },
  { name: "Commodities & FX", symbols: [["TVC:UKOIL", "Brent crude"], ["TVC:GOLD", "Gold"], ["FX_IDC:USDINR", "USD/INR"], ["CAPITALCOM:DXY", "Dollar index"],
    ["OANDA:USB10YUSD", "US 10Y note (price)"]] },
];
export const globalQuotesUrl = theme => "https://s.tradingview.com/embed-widget/market-quotes/?locale=en#" + encodeURIComponent(JSON.stringify({
  width: "100%", height: "100%", colorTheme: theme === "dark" ? "dark" : "light", isTransparent: true, showSymbolLogo: false,
  symbolsGroups: GLOBAL_GROUPS.map(group => ({ name: group.name, symbols: group.symbols.map(([name, displayName]) => ({ name, displayName })) })),
}));

/** Green-to-red background for a % move, readable in both themes. */
export const heat = pc => {
  if (!Number.isFinite(pc)) return "action.hover";
  const strength = Math.min(1, Math.abs(pc) / 3);
  return pc >= 0 ? `rgba(31, 184, 138, ${0.12 + strength * 0.55})` : `rgba(229, 72, 77, ${0.12 + strength * 0.55})`;
};

/** Squarified treemap layout (Bruls et al.), as in the Money Flow file. items: [{v, ...}] largest first. */
export function squarify(items, x, y, w, h) {
  const out = [];
  let rest = items.slice();
  const worst = (row, side) => {
    const sum = row.reduce((a, b) => a + b.v, 0), max = Math.max(...row.map(r => r.v)), min = Math.min(...row.map(r => r.v));
    return Math.max(side * side * max / (sum * sum), sum * sum / (side * side * min));
  };
  while (rest.length && w > 0 && h > 0) {
    const side = Math.min(w, h);
    let row = [rest[0]], best = worst(row, side);
    for (let i = 1; i < rest.length; i += 1) {
      const next = row.concat(rest[i]), score = worst(next, side);
      if (score <= best) { row = next; best = score; } else break;
    }
    const sum = row.reduce((a, b) => a + b.v, 0);
    if (w >= h) {
      const rowWidth = sum / h;
      let top = y;
      for (const item of row) {
        const height = item.v / rowWidth;
        out.push({ ...item, x, y: top, w: rowWidth, h: height });
        top += height;
      }
      x += rowWidth; w -= rowWidth;
    } else {
      const rowHeight = sum / w;
      let left = x;
      for (const item of row) {
        const width = item.v / rowHeight;
        out.push({ ...item, x: left, y, w: width, h: rowHeight });
        left += width;
      }
      y += rowHeight; h -= rowHeight;
    }
    rest = rest.slice(row.length);
  }
  return out;
}

function IndexCard({ ix }) {
  const vix = ix.key === "INDIAVIX";
  const good = vix ? ix.pc <= 0 : ix.pc >= 0;
  const change = Number.isFinite(ix.ltp) && Number.isFinite(ix.prev) ? ix.ltp - ix.prev : NaN;
  const range = ix.high > ix.low ? (ix.ltp - ix.low) / (ix.high - ix.low) * 100 : 50;
  return <Box component="article" aria-label={ix.label} sx={{ p: 1.25, borderRadius: 2, bgcolor: "background.paper", border: 1, borderColor: "divider", minWidth: 0 }}>
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5 }}>{ix.label}</Typography>
      <Typography sx={{ ...mono, fontSize: 12, fontWeight: 800, color: good ? UP : DOWN }}>{good ? "▲" : "▼"} {fpc(ix.pc)}</Typography>
    </Box>
    <Typography sx={{ ...mono, fontSize: 20, fontWeight: 850, mt: 0.25 }}>{fp(ix.ltp)}
      <Box component="small" sx={{ ml: 0.75, fontSize: 12, color: good ? UP : DOWN }}>{Number.isFinite(change) ? `${change >= 0 ? "+" : ""}${change.toFixed(vix ? 2 : 1)}` : ""}</Box>
    </Typography>
    <Box title={`Day range ${fp(ix.low)} – ${fp(ix.high)}`} sx={{ position: "relative", height: 5, borderRadius: 3, bgcolor: "action.hover", my: 0.75 }}>
      <Box sx={{ position: "absolute", top: -2, left: `calc(${Math.max(0, Math.min(100, range))}% - 4px)`, width: 9, height: 9, borderRadius: "50%", bgcolor: good ? UP : DOWN }} />
    </Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
      {vix ? (ix.ltp < 12 ? "Very calm — option premiums cheap" : ix.ltp < 16 ? "Normal volatility" : ix.ltp < 20 ? "Nervous — wider swings" : "Fear — big swings likely")
        : `PDH ${fp(ix.prevH)} · PDL ${fp(ix.prevL)}`}
    </Typography>
  </Box>;
}

function Gauge({ score }) {
  const cx = 110, cy = 104, r = 86;
  const angle = Math.PI * (1 - (score + 100) / 200);
  const arc = (from, to, color) => {
    const a1 = Math.PI * (1 - from), a2 = Math.PI * (1 - to);
    return <path d={`M${cx + r * Math.cos(a1)} ${cy - r * Math.sin(a1)} A${r} ${r} 0 0 1 ${cx + r * Math.cos(a2)} ${cy - r * Math.sin(a2)}`} stroke={color} strokeWidth="14" fill="none" />;
  };
  return <Box component="svg" viewBox="0 0 220 118" role="img" aria-label={`Mood score ${Math.round(score)}`} sx={{ width: 180, flex: "none", color: "text.primary" }}>
    {arc(0, 0.2, "#e5484d")}{arc(0.2, 0.4, "rgba(229,72,77,0.45)")}{arc(0.4, 0.6, "rgba(128,128,128,0.3)")}{arc(0.6, 0.8, "rgba(31,184,138,0.45)")}{arc(0.8, 1, "#1fb88a")}
    <line x1={cx} y1={cy} x2={cx + r * Math.cos(angle) * 0.86} y2={cy - r * Math.sin(angle) * 0.86} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <circle cx={cx} cy={cy} r="6" fill="currentColor" />
  </Box>;
}

function Mood({ mood }) {
  return <>
    <Box sx={{ display: "flex", gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
      <Gauge score={mood.score} />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 850, color: mood.score > 18 ? UP : mood.score < -18 ? DOWN : "text.secondary" }}>{mood.label}</Typography>
        <Typography variant="caption" color="text.secondary">score {mood.score >= 0 ? "+" : ""}{mood.score.toFixed(0)} of ±100</Typography>
        <Box sx={{ height: 6, borderRadius: 3, bgcolor: DOWN, overflow: "hidden", my: 0.75, width: 180 }}>
          <Box sx={{ height: 1, width: `${mood.adv / (mood.adv + mood.dec || 1) * 100}%`, bgcolor: UP }} />
        </Box>
        <Typography variant="caption"><Box component="span" sx={{ color: UP }}>{mood.adv} advancing</Box> · <Box component="span" sx={{ color: DOWN }}>{mood.dec} declining</Box></Typography>
      </Box>
    </Box>
    {mood.parts.map(part => <Box key={part.name} sx={{ display: "grid", gridTemplateColumns: "96px 1fr 120px", gap: 1, alignItems: "center", mt: 0.75, fontSize: 12.5 }}>
      <span>{part.name}</span>
      <Box sx={{ position: "relative", height: 6, borderRadius: 3, bgcolor: "action.hover" }}>
        <Box sx={{ position: "absolute", top: 0, bottom: 0, borderRadius: 3, left: `${part.value >= 0 ? 50 : 50 + part.value / 2}%`, width: `${Math.abs(part.value) / 2}%`, bgcolor: part.value >= 0 ? UP : DOWN }} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ ...mono, textAlign: "right" }}>{part.note}</Typography>
    </Box>)}
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Global cues are shown alongside; their moves are not scored because TradingView's widget does not share its numbers. GIFT Nifty is not available in the free widget.</Typography>
  </>;
}

function GlobalCues() {
  const { theme } = useTheme();
  return <Box sx={{ position: "relative", height: { xs: 520, md: 430 } }}>
    <Box component="iframe" key={theme} title="Global markets from TradingView" src={globalQuotesUrl(theme)} loading="lazy"
      sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }} />
  </Box>;
}

function SectorHeat({ stocks, flows, onTrace }) {
  const sectors = useMemo(() => {
    const groups = {};
    stocks.forEach(st => {
      const o = groups[st.sector] = groups[st.sector] || { sector: st.sector, n: 0, sum: 0, up: 0, down: 0 };
      o.n += 1; o.sum += st.pc;
      if (st.pc > 0.1) o.up += 1; else if (st.pc < -0.1) o.down += 1;
    });
    return Object.values(groups).map(o => ({ ...o, avg: o.sum / o.n })).sort((a, b) => b.avg - a.avg);
  }, [stocks]);
  const tags = Object.fromEntries(flows.map(o => [o.sector, o.tag]));
  return <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(124px, 1fr))", gap: 0.75 }}>
    {sectors.map(o => <Box key={o.sector} component="button" type="button" onClick={() => onTrace(o.sector)} title={`${o.sector}: ${o.up} up, ${o.down} down · trace on Money Flow`}
      sx={{ all: "unset", cursor: "pointer", p: 1, borderRadius: 1.5, bgcolor: heat(o.avg), minHeight: 64, display: "flex", flexDirection: "column", gap: 0.25,
        "&:hover, &:focus-visible": { outline: 2, outlineColor: "text.primary" } }}>
      <Typography sx={{ fontSize: 12, fontWeight: 800, lineHeight: 1.2 }}>{o.sector}</Typography>
      <Typography sx={{ ...mono, fontSize: 15, fontWeight: 850 }}>{fpc(o.avg)}</Typography>
      <Typography sx={{ fontSize: 10.5, opacity: 0.85 }}>{o.up}▲ {o.down}▼{tags[o.sector] ? ` · ${FLOW_TAGS[tags[o.sector]].toLowerCase()}` : ""}</Typography>
    </Box>)}
  </Box>;
}

function NiftyMap({ snapshot, onPick }) {
  const box = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const measure = () => setSize({ w: element.clientWidth, h: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const { list } = contributions("NIFTY", snapshot);
  const weighted = list.filter(x => Number.isFinite(x.weight) && x.weight > 0);
  const items = (weighted.length ? weighted.map(x => ({ st: x.st, w: x.weight }))
    : snapshot.stocks.filter(st => st.n50).map(st => ({ st, w: st.value }))).filter(x => x.w > 0).sort((a, b) => b.w - a.w);
  const total = items.reduce((sum, x) => sum + x.w, 0);
  const tiles = size.w && total ? squarify(items.map(x => ({ ...x, v: x.w / total * size.w * size.h })), 0, 0, size.w, size.h) : [];
  return <Box ref={box} role="group" aria-label="Nifty 50 heatmap" sx={{ position: "relative", height: { xs: 320, md: 360 }, borderRadius: 1.5, overflow: "hidden" }}>
    {tiles.map(tile => <Box key={tile.st.sym} component="button" type="button" onClick={() => onPick(tile.st.sym)}
      title={`${tile.st.sym} ${fpc(tile.st.pc)} · ${weighted.length ? `weight ${tile.w.toFixed(2)}%` : `₹${(tile.w / 1e7).toFixed(0)} Cr traded`}`}
      sx={{ all: "unset", cursor: "pointer", position: "absolute", left: tile.x, top: tile.y, width: Math.max(0, tile.w - 2), height: Math.max(0, tile.h - 2),
        bgcolor: heat(tile.st.pc), display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: 0.5,
        "&:hover, &:focus-visible": { outline: 2, outlineColor: "text.primary", zIndex: 1 } }}>
      {tile.w > 44 && tile.h > 28 && <><Typography sx={{ fontSize: 11, fontWeight: 800, lineHeight: 1.1 }}>{tile.st.sym}</Typography>
        <Typography sx={{ ...mono, fontSize: 10.5 }}>{fpc(tile.st.pc)}</Typography></>}
    </Box>)}
    {!tiles.length && <Typography color="text.secondary" sx={{ p: 2, fontSize: 13 }}>Nifty 50 prices load with the market data.</Typography>}
  </Box>;
}

function Movers({ stocks, onPick }) {
  const [kind, setKind] = useState("gain");
  const [fnoOnly, setFnoOnly] = useState(false);
  const [, title, pick, detail] = MOVERS.find(([key]) => key === kind);
  const list = pick(stocks.filter(st => !fnoOnly || st.fno)).slice(0, 12);
  return <>
    <Box role="group" aria-label="Movers list" sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1 }}>
      {MOVERS.map(([key, label]) => <Chip key={key} label={label} size="small" clickable color={key === kind ? "primary" : "default"}
        variant={key === kind ? "filled" : "outlined"} onClick={() => setKind(key)} aria-pressed={key === kind} />)}
    </Box>
    <Box role="table" aria-label={title} sx={{ overflowX: "auto" }}>
      <Box role="row" sx={{ display: "grid", gridTemplateColumns: "24px minmax(110px, 1.3fr) 84px 76px minmax(110px, 1fr) minmax(90px, 1fr)", gap: 1, fontSize: 11, color: "text.secondary", fontWeight: 700, pb: 0.5, minWidth: 520 }}>
        <span role="columnheader">#</span><span role="columnheader">Stock</span><Box component="span" role="columnheader" sx={{ textAlign: "right" }}>LTP</Box>
        <Box component="span" role="columnheader" sx={{ textAlign: "right" }}>Chg</Box><Box component="span" role="columnheader" sx={{ textAlign: "right" }}>Detail</Box><span role="columnheader">Sector</span>
      </Box>
      {list.map((st, i) => <Box key={st.sym} role="row" sx={{ display: "grid", gridTemplateColumns: "24px minmax(110px, 1.3fr) 84px 76px minmax(110px, 1fr) minmax(90px, 1fr)", gap: 1, py: 0.5, borderTop: 1, borderColor: "divider", fontSize: 12.5, alignItems: "center", minWidth: 520 }}>
        <Box component="span" role="cell" sx={{ color: "text.secondary" }}>{i + 1}</Box>
        <span role="cell"><NameButton st={st} onPick={onPick} badges /></span>
        <Box component="span" role="cell" sx={{ ...mono, textAlign: "right" }}>{fp(st.ltp)}</Box>
        <Box component="span" role="cell" sx={{ textAlign: "right" }}><Pct value={st.pc} sx={{ fontWeight: 800 }} /></Box>
        <Box component="span" role="cell" sx={{ textAlign: "right", color: "text.secondary", whiteSpace: "nowrap" }}>{detail(st)}</Box>
        <Box component="span" role="cell" sx={{ color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.sector}</Box>
      </Box>)}
      {!list.length && <Typography color="text.secondary" sx={{ py: 2, fontSize: 13 }}>
        {kind === "hi52" || kind === "lo52" ? "No stock near its 52-week extreme right now." : kind === "uc" || kind === "lc" ? "No cash stock near its circuit limit right now." : "Nothing qualifies right now."}
      </Typography>}
    </Box>
    <Box sx={{ mt: 1 }}><Chip size="small" label="F&O only" clickable color={fnoOnly ? "primary" : "default"} variant={fnoOnly ? "filled" : "outlined"}
      onClick={() => setFnoOnly(value => !value)} aria-pressed={fnoOnly} /></Box>
  </>;
}

function Breadth({ stocks }) {
  const groups = breadthGroups(stocks);
  return <>
    {groups.map(group => <Box key={group.label} sx={{ display: "grid", gridTemplateColumns: "88px 1fr 80px", gap: 1, alignItems: "center", py: 0.4, fontSize: 12.5 }}>
      <span>{group.label}</span>
      <Box sx={{ display: "flex", height: 7, borderRadius: 4, overflow: "hidden", bgcolor: "action.hover" }}>
        <Box sx={{ width: `${group.up / group.n * 100}%`, bgcolor: UP }} />
        <Box sx={{ width: `${group.flat / group.n * 100}%`, bgcolor: "text.disabled", opacity: 0.35 }} />
        <Box sx={{ width: `${group.down / group.n * 100}%`, bgcolor: DOWN }} />
      </Box>
      <Box component="span" sx={{ ...mono, textAlign: "right" }}><Box component="span" sx={{ color: UP }}>{group.up}</Box> / <Box component="span" sx={{ color: DOWN }}>{group.down}</Box></Box>
    </Box>)}
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>{capRead(groups)}</Typography>
  </>;
}

export default function MarketPage({ api }) {
  const { snapshot, error, loading } = useBoard(api);
  const [pick, setPick] = useState(null);
  const stocks = useMemo(() => snapshot?.stocks || [], [snapshot]);
  const flows = useMemo(() => sectorFlow(stocks), [stocks]);
  const mood = useMemo(() => snapshot ? moodScore(stocks, snapshot.idx, snapshot.pcr, flows) : null, [snapshot, stocks, flows]);
  const trace = sector => {
    try { sessionStorage.setItem(FLOW_SECTOR_KEY, sector); } catch { /* storage unavailable */ }
    window.location.hash = "money-flow";
  };
  const asOf = snapshot?.asOf ? new Date(snapshot.asOf * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }) : null;
  return <PageShell className="market-page" maxWidth={1680}>
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "1.4rem", md: "1.55rem" } }}>Market</Typography>
          <StatusChip snapshot={snapshot} error={error} />
        </Box>
        <Typography variant="body2" color="text.secondary">
          {stocks.length ? `${stocks.length} NIFTY 500 and F&O stocks${asOf ? ` · as of ${asOf} IST` : ""}` : loading ? "Loading market data…" : "Market data appears once Zerodha is connected."}
        </Typography>
      </Box>
      <Autocomplete size="small" options={stocks} getOptionLabel={st => st.sym} sx={{ width: { xs: "100%", sm: 260 } }}
        filterOptions={(options, { inputValue }) => { const q = inputValue.trim().toUpperCase(); return q ? options.filter(st => st.sym.includes(q) || (st.company || "").toUpperCase().includes(q)).slice(0, 30) : options.slice(0, 30); }}
        renderOption={(props, st) => <li {...props} key={st.sym}><b>{st.sym}</b>&nbsp;<Box component="span" sx={{ color: "text.secondary", fontSize: 12 }}>{st.sector}</Box></li>}
        renderInput={params => <TextField {...params} label="Search stock" />} value={null} blurOnSelect clearOnBlur
        onChange={(_, st) => st && setPick(st.sym)} />
    </Box>
    <BoardMessage snapshot={snapshot} error={error} />
    {snapshot && <>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" }, gap: 1, mb: 1.5 }}>
        {INDEX_CARDS.map(key => snapshot.idx[key]).filter(ix => ix && Number.isFinite(ix.ltp)).map(ix => <IndexCard key={ix.key} ix={ix} />)}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) minmax(0, 1.3fr)" }, gap: 1.5, mb: 1.5 }}>
        <Panel title="Market mood" note="breadth · VIX · PCR · sector money">{mood && <Mood mood={mood} />}</Panel>
        <Panel title="🌐 Global cues" note="US closed overnight · Asia live · Europe from 13:30 IST"><GlobalCues /></Panel>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) minmax(0, 1fr)" }, gap: 1.5, mb: 1.5 }}>
        <Panel title="Sector heatmap" note="average move · click to trace its money"><SectorHeat stocks={stocks} flows={flows} onTrace={trace} /></Panel>
        <Panel title="Nifty 50 heatmap" note="box size = index weight · click a box"><NiftyMap snapshot={snapshot} onPick={setPick} /></Panel>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 2fr) minmax(0, 1fr)" }, gap: 1.5 }}>
        <Panel title="Market movers" note="click a name for its card"><Movers stocks={stocks} onPick={setPick} /></Panel>
        <Panel title="Breadth by group" note="advancing / declining"><Breadth stocks={stocks} /></Panel>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        Prices from Zerodha; global quotes from TradingView. FII/DII flows and delivery % are not available from Zerodha and are left out. Information only, not investment advice.
      </Typography>
    </>}
    <StockDrawer sym={pick} snapshot={snapshot} api={api} onClose={() => setPick(null)} />
  </PageShell>;
}
