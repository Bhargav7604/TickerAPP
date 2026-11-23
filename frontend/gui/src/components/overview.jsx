// Home for the Indian market: the whole app on one screen. Each tile sums up one page; clicking a tile opens it.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, IconButton, Link, Paper, Tooltip, Typography } from "@mui/material";
import { alpha, useTheme as useMuiTheme } from "@mui/material/styles";
import { Maximize2 } from "lucide-react";
import { contributions, fp, fpc, fpcBare, moodScore, poll, sectorFlow, useBoard } from "../boardData";
import { formatPrice, shortOi, signedShortOi } from "../oiData";
import { changeSinceOpen } from "../straddleData";
import { timeAgo } from "../newsData";
import { StatusChip, Tag, toneColor } from "./boardUi";
import { GlobalCues } from "./globalCues";
import { NAV_ITEMS } from "./navbar";
import { mono, PageShell } from "../ui/Glass";
import { withArrow } from "../trend";

const finite = value => typeof value === "number" && Number.isFinite(value);
const pageName = page => NAV_ITEMS.find(([id]) => id === page)?.[1] || page;
const signed = (value, places = 2) => finite(value) ? withArrow(value, `${value > 0 ? "+" : ""}${value.toFixed(places)}`, places) : "--";
const dayLabel = iso => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "";
const clock = seconds => new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
const STRIP = ["NIFTY", "BANKNIFTY", "SENSEX", "INDIAVIX"];
const LIGHTS = { green: "success.main", yellow: "warning.main", red: "error.main" };
const DIRECTION_COLORS = { up: "success", down: "error" };
const OI_INDEX = "nifty";

/** Calls `load` now and then every `every` ms while the tab is visible; keeps the last good data through a failed call. */
function usePolled(load, every) {
  const [state, setState] = useState({ data: null, error: "", loading: Boolean(load) });
  useEffect(() => {
    if (!load) return undefined;
    return poll(async (signal, stopped) => {
      try {
        const data = await load(signal);
        if (!stopped()) setState({ data, error: "", loading: false });
      } catch (exc) {
        if (!stopped() && exc.name !== "AbortError") setState(previous => ({ ...previous, error: exc.message || "Unavailable right now.", loading: false }));
      }
    }, every);
  }, [load, every]);
  return state;
}

/** The nearest NIFTY expiry with recorded OI, looked up once and then reused by `fetch`. */
function useNiftyExpiry(api, fetch, every) {
  const expiry = useRef("");
  const load = useCallback(async signal => {
    if (!expiry.current) {
      const meta = await api.expiries(OI_INDEX, signal);
      expiry.current = meta.recorded?.[0] || meta.expiries?.[0] || "";
      if (!expiry.current) throw new Error("No upcoming NIFTY expiry.");
    }
    return fetch(api, expiry.current, signal);
  }, [api, fetch]);
  return usePolled(api ? load : null, every);
}

const fetchChain = async (api, expiry, signal) => {
  const live = await api.liveChain(OI_INDEX, expiry, 15, "atm", signal).catch(exc => { if (exc.name === "AbortError") throw exc; return null; });
  if (live?.live && live.rows?.length) return { ...live, live: true };
  return { ...(await api.chain(OI_INDEX, expiry, 15, "atm", signal)), live: false };
};
const fetchStraddle = (api, expiry, signal) => api.load(OI_INDEX, expiry, "", signal);

function Empty({ children }) {
  return <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: "center" }}>{children}</Typography>;
}

/** One tile: a title bar with an open button; clicking anywhere outside a link or control also opens the page. */
function Tile({ title, note, page, open, children, bodySx, sx }) {
  const name = pageName(page);
  return <Paper component="section" aria-label={title} data-page={page}
    onClick={event => { if (!event.target.closest("a, button, input, select, iframe, [role='button']")) open(); }}
    sx={{
      display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, height: { md: "100%" }, overflow: "hidden", cursor: "pointer",
      transition: "box-shadow 160ms ease", "&:hover": { boxShadow: theme => `0 0 0 1px ${alpha(theme.palette.primary.main, 0.55)}` }, ...sx,
    }}>
    <Box sx={{ flex: "none", display: "flex", alignItems: "center", gap: 1, pl: 1.75, pr: 0.75, py: 0.6, borderBottom: 1, borderColor: "divider" }}>
      <Typography component="h2" sx={{ fontSize: 15, fontWeight: 800, whiteSpace: "nowrap" }}>{title}</Typography>
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 0.75, overflow: "hidden", whiteSpace: "nowrap", color: "text.secondary", fontSize: 12.5 }}>{note}</Box>
      <Tooltip title={`Open ${name}`}>
        <IconButton size="small" aria-label={`Open ${name}`} onClick={open} sx={{ color: "text.secondary" }}><Maximize2 size={15} /></IconButton>
      </Tooltip>
    </Box>
    <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1.5, maxHeight: { xs: 420, md: "none" }, ...bodySx }}>{children}</Box>
  </Paper>;
}

function IndexStrip({ snapshot, cards, open }) {
  const byKey = Object.fromEntries((cards || []).map(card => [card.key, card]));
  const rows = STRIP.map(key => snapshot?.idx[key]).filter(ix => ix && finite(ix.ltp));
  return <Paper component="section" aria-label="Indices" onClick={event => { if (!event.target.closest("button")) open(); }}
    sx={{ display: "flex", alignItems: "center", gap: 0, mb: 1.5, pl: 0.5, pr: 0.75, py: 0.75, overflowX: "auto", cursor: "pointer" }}>
    {!rows.length && <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 0.5, flex: 1 }}>Index prices appear once the market feed is running.</Typography>}
    {rows.map((ix, position) => {
      const change = finite(ix.prev) ? ix.ltp - ix.prev : NaN;
      const card = byKey[ix.key.toLowerCase()];
      return <Box key={ix.key} data-index={ix.key} sx={{ flex: "none", display: "flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.25, whiteSpace: "nowrap",
        borderLeft: position ? 1 : 0, borderColor: "divider" }}>
        <Typography component="span" sx={{ fontSize: 13, fontWeight: 800 }}>{ix.label}</Typography>
        <Box component="span" sx={{ ...mono, fontWeight: 700, fontSize: 15 }}>{fp(ix.ltp)}</Box>
        <Box component="span" sx={{ ...mono, fontSize: 13, color: toneColor(change) }}>{signed(change)} ({fpcBare(ix.pc)})</Box>
        {card?.direction && <Tag color={DIRECTION_COLORS[card.direction.code] || "default"} title={card.direction.detail}
          sx={{ display: { xs: "inline-flex", md: "none", xl: "inline-flex" } }}>{card.direction.label}</Tag>}
      </Box>;
    })}
    <Box sx={{ flex: 1 }} />
    {finite(snapshot?.pcr) && <Typography component="span" sx={{ flex: "none", px: 1, fontSize: 13, color: "text.secondary", whiteSpace: "nowrap" }}>
      NIFTY PCR <Box component="span" sx={{ ...mono, fontWeight: 700, color: "text.primary" }}>{snapshot.pcr.toFixed(2)}</Box>
    </Typography>}
    <Tooltip title="Open Market"><IconButton size="small" aria-label="Open Market" onClick={open} sx={{ flex: "none", color: "text.secondary" }}><Maximize2 size={15} /></IconButton></Tooltip>
  </Paper>;
}

function Synopsis({ stocks }) {
  const top = (key, direction) => stocks.filter(st => finite(st[key]) && direction * st[key] > 0)
    .sort((a, b) => direction * (b[key] - a[key])).slice(0, 4);
  const boxes = [["Price up", "success", top("pc", 1), "pc"], ["Price down", "error", top("pc", -1), "pc"],
    ["OI up", "success", top("oc", 1), "oc"], ["OI down", "error", top("oc", -1), "oc"]];
  return <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1 }}>
    {boxes.map(([label, color, rows, key]) => <Box key={label} role="group" aria-label={label}
      sx={{ px: 1, py: 0.75, borderRadius: 2, bgcolor: theme => alpha(theme.palette[color].main, 0.09) }}>
      <Typography sx={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: `${color}.main`, mb: 0.5 }}>
        {color === "success" ? "▲" : "▼"} {label}
      </Typography>
      {!rows.length && <Typography variant="caption" color="text.secondary">None yet</Typography>}
      {rows.map((st, position) => <Box key={st.sym} sx={{ display: "grid", gridTemplateColumns: "14px minmax(0, 1fr) auto", gap: 0.75, alignItems: "baseline", py: 0.1 }}>
        <Box component="span" sx={{ fontSize: 11, color: "text.secondary" }}>{position + 1}</Box>
        <Box component="span" sx={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>{st.sym}</Box>
        <Box component="span" sx={{ ...mono, fontSize: 12.5, fontWeight: 700, color: `${color}.main` }}>{fpcBare(st[key])}</Box>
      </Box>)}
    </Box>)}
  </Box>;
}

function ChainSnippet({ chain }) {
  const rows = [...(chain.rows || [])].sort((a, b) => a.strike - b.strike);
  if (!rows.length) return <Empty>No option chain recorded yet.</Empty>;
  let centre = rows.findIndex(row => row.strike === chain.atm);
  if (centre < 0) centre = rows.reduce((best, row, index) => Math.abs(row.strike - chain.underlying) < Math.abs(rows[best].strike - chain.underlying) ? index : best, 0);
  const shown = rows.slice(Math.max(0, centre - 2), centre + 3);
  const head = { fontSize: 11, fontWeight: 700, color: "text.secondary", textAlign: "center", py: 0.5, px: 0.5 };
  const cell = { ...mono, fontSize: 12.5, textAlign: "center", py: 0.6, px: 0.5, borderTop: 1, borderColor: "divider" };
  const itm = theme => alpha(theme.palette.warning.main, 0.08);
  const wideOnly = { display: { xs: "none", sm: "table-cell" } };   // phones keep OI and LTP only
  // One side of a strike, outside-in for calls (OI, ΔOI, LTP) and mirrored for puts.
  const side = (row, part, inMoney) => {
    const value = row[part] || {};
    const shade = inMoney ? itm : undefined;
    const cells = [
      <Box component="td" key={`${part}-oi`} sx={{ ...cell, bgcolor: shade }}>{shortOi(value.oi)}</Box>,
      <Box component="td" key={`${part}-change`} sx={{ ...cell, ...wideOnly, color: toneColor(value.oiChange), bgcolor: shade }}>{signedShortOi(value.oiChange)}</Box>,
      <Box component="td" key={`${part}-ltp`} sx={{ ...cell, fontWeight: 700, bgcolor: shade }}>{formatPrice(value.ltp)}</Box>,
    ];
    return part === "call" ? cells : cells.reverse();
  };
  return <Box>
    <Box aria-hidden="true" sx={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 800, px: 0.5 }}>
      <Box component="span" sx={{ color: "success.main" }}>Calls</Box><Box component="span" sx={{ color: "error.main" }}>Puts</Box>
    </Box>
    <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <caption className="sr-only">NIFTY option chain around the ATM strike: calls on the left, puts on the right</caption>
      <thead>
        <tr>{["OI", "ΔOI", "LTP"].map(label => <Box component="th" key={`c${label}`} scope="col" sx={{ ...head, ...(label === "ΔOI" ? wideOnly : {}) }}>{label}</Box>)}
          <Box component="th" scope="col" sx={head}>Strike</Box>
          {["LTP", "ΔOI", "OI"].map(label => <Box component="th" key={`p${label}`} scope="col" sx={{ ...head, ...(label === "ΔOI" ? wideOnly : {}) }}>{label}</Box>)}</tr>
      </thead>
      <tbody>{shown.map(row => {
        const atm = row.strike === chain.atm;
        return <tr key={row.strike} data-strike={row.strike} aria-current={atm ? "true" : undefined}>
          {side(row, "call", row.strike < chain.underlying)}
          <Box component="th" scope="row" sx={{ ...cell, fontWeight: 800, bgcolor: "action.hover", color: atm ? "primary.main" : "text.primary" }}>
            {row.strike.toLocaleString("en-IN")}{atm && <Box component="small" sx={{ display: "block", fontSize: 9.5, fontWeight: 800 }}>ATM</Box>}
          </Box>
          {side(row, "put", row.strike > chain.underlying)}
        </tr>;
      })}</tbody>
    </Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
      Spot <Box component="span" sx={{ ...mono, color: "text.primary" }}>{formatPrice(chain.underlying)}</Box>
      {finite(chain.totals?.pcr) && <> · PCR <Box component="span" sx={{ ...mono, color: "text.primary" }}>{chain.totals.pcr.toFixed(2)}</Box></>}
      {" "}· shaded = in the money · ΔOI since yesterday
    </Typography>
  </Box>;
}

function ContributorBar({ value, max }) {
  return <Box sx={{ height: 4, borderRadius: 2, bgcolor: "action.hover", mt: 0.25 }}>
    <Box sx={{ height: "100%", borderRadius: 2, width: `${Math.max(2, Math.abs(value) / max * 100)}%`, bgcolor: value >= 0 ? "success.main" : "error.main" }} />
  </Box>;
}

function StockContributors({ list }) {
  const up = list.filter(x => x.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 8);
  const down = list.filter(x => x.pts < 0).sort((a, b) => a.pts - b.pts).slice(0, 8);
  if (!up.length && !down.length) return <Empty>Contributions appear once NIFTY stocks are trading.</Empty>;
  const max = Math.max(1e-9, ...[...up, ...down].map(x => Math.abs(x.pts)));
  const column = (rows, label) => <Box role="list" aria-label={label} sx={{ minWidth: 0 }}>
    {rows.map(({ st, pts }) => <Box role="listitem" key={st.sym} sx={{ mb: 0.75 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
        <Box component="span" sx={{ fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st.sym}</Box>
        <Box component="span" sx={{ ...mono, fontSize: 12.5, fontWeight: 700, color: toneColor(pts) }}>{signed(pts)}</Box>
      </Box>
      <ContributorBar value={pts} max={max} />
    </Box>)}
  </Box>;
  return <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 2 }}>
    {column(up, "Adding to NIFTY")}{column(down, "Taking from NIFTY")}
  </Box>;
}

function SectorContributors({ list }) {
  const sectors = {};
  list.forEach(({ st, pts }) => { const name = st.sector || "Others"; sectors[name] = (sectors[name] || 0) + pts; });
  const rows = Object.entries(sectors).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <Empty>Sector points appear once NIFTY stocks are trading.</Empty>;
  const max = Math.max(1e-9, ...rows.map(([, pts]) => Math.abs(pts)));
  return <Box role="list" aria-label="NIFTY points by sector">
    {rows.map(([name, pts]) => <Box role="listitem" key={name} sx={{ display: "grid", gridTemplateColumns: "minmax(0, 120px) minmax(0, 1fr) 64px", gap: 1, alignItems: "center", py: 0.3 }}>
      <Box component="span" sx={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</Box>
      <Box sx={{ position: "relative", height: 10 }}>
        <Box sx={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: "1px", bgcolor: "divider" }} />
        <Box sx={{ position: "absolute", top: 1, bottom: 1, borderRadius: 1, bgcolor: pts >= 0 ? "success.main" : "error.main",
          width: `${Math.abs(pts) / max * 50}%`, ...(pts >= 0 ? { left: "50%" } : { right: "50%" }) }} />
      </Box>
      <Box component="span" sx={{ ...mono, fontSize: 12.5, fontWeight: 700, textAlign: "right", color: toneColor(pts) }}>{signed(pts)}</Box>
    </Box>)}
  </Box>;
}

function Signals({ cards }) {
  if (!cards.length) return <Empty>No index signals yet.</Empty>;
  return <Box>{cards.map(card => <Box key={card.key} data-index={card.key} sx={{ py: 0.9, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 }, "&:first-of-type": { pt: 0 } }}>
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
      <Box aria-hidden="true" sx={{ flex: "none", width: 10, height: 10, borderRadius: "50%", bgcolor: LIGHTS[card.light?.color] || "text.disabled" }} />
      <Typography component="span" sx={{ fontWeight: 800, fontSize: 14 }}>{card.label}</Typography>
      <Box sx={{ flex: 1 }} />
      <Box component="span" sx={{ ...mono, fontSize: 13, fontWeight: 700 }}>{fp(card.price)}</Box>
      <Box component="span" sx={{ ...mono, fontSize: 12.5, color: toneColor(card.change?.pct) }}>{fpc(card.change?.pct)}</Box>
    </Box>
    <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: LIGHTS[card.light?.color] || "text.secondary", mt: 0.25 }}>{card.light?.label}</Typography>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{[card.direction?.label, card.bigPlayers?.label].filter(Boolean).join(" · ")}</Typography>
  </Box>)}</Box>;
}

function Sparkline({ values, up }) {
  const theme = useMuiTheme();
  const points = values.map((value, slot) => [slot, value]).filter(([, value]) => finite(value));
  if (points.length < 2) return null;
  const numbers = points.map(([, value]) => value);
  const low = Math.min(...numbers), span = Math.max(...numbers) - low || 1;
  const path = points.map(([slot, value], i) => `${i ? "L" : "M"}${(slot / Math.max(1, values.length - 1) * 100).toFixed(2)} ${(38 - (value - low) / span * 34).toFixed(2)}`).join(" ");
  return <Box component="svg" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" sx={{ display: "block", width: "100%", height: 64, mt: 1 }}>
    <path d={path} fill="none" stroke={up ? theme.palette.success.main : theme.palette.error.main} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
  </Box>;
}

function StraddleSummary({ data }) {
  const now = changeSinceOpen(data.series, data.current);
  if (!now) return <Empty>{data.message || "No straddle recorded yet today."}</Empty>;
  const stat = (label, value) => <Box sx={{ minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", textTransform: "uppercase", letterSpacing: 0.5, fontSize: 10.5 }}>{label}</Typography>
    <Box sx={{ ...mono, fontSize: 14, fontWeight: 700 }}>{value}</Box>
  </Box>;
  return <Box>
    <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.5, fontSize: 10.5 }}>ATM straddle</Typography>
    <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap" }}>
      <Box data-testid="home-straddle" sx={{ ...mono, fontSize: 26, fontWeight: 800 }}>{formatPrice(now.value)}</Box>
      <Box component="span" sx={{ ...mono, fontSize: 13, color: toneColor(now.change) }}>
        {signed(now.change)}{finite(now.pct) ? ` (${fpcBare(now.pct)})` : ""} since {clock(now.since)}
      </Box>
    </Box>
    <Sparkline values={data.series?.lines?.ATM || []} up={now.change >= 0} />
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1, mt: 1 }}>
      {stat("Spot", formatPrice(data.current?.spot))}{stat("ATM strike", data.current?.atm?.toLocaleString("en-IN") ?? "--")}{stat("Days to expiry", data.dte ?? "--")}
    </Box>
  </Box>;
}

function Breadth({ stocks, snapshot }) {
  const sectors = useMemo(() => sectorFlow(stocks), [stocks]);
  const mood = useMemo(() => moodScore(stocks, snapshot.idx, snapshot.pcr, sectors), [stocks, snapshot, sectors]);
  const flat = stocks.length - mood.adv - mood.dec;
  const total = Math.max(1, stocks.length);
  const inflow = sectors.filter(o => o.tag === "in" || o.tag === "acc").slice(0, 3).map(o => o.sector);
  const outflow = sectors.filter(o => o.tag === "out" || o.tag === "dis").slice(-3).reverse().map(o => o.sector);
  const moodColor = mood.score > 18 ? "success.main" : mood.score < -18 ? "error.main" : "text.primary";
  return <Box>
    <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 0.5, fontSize: 10.5 }}>Market mood</Typography>
    <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
      <Typography sx={{ fontSize: 22, fontWeight: 800, color: moodColor }}>{mood.label}</Typography>
      <Box component="span" sx={{ ...mono, fontSize: 13, color: "text.secondary" }}>score {signed(mood.score, 0)}</Box>
    </Box>
    <Box role="img" aria-label={`${mood.adv} advancing, ${mood.dec} declining, ${flat} unchanged`}
      sx={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", mt: 1.25, bgcolor: "action.hover" }}>
      <Box sx={{ width: `${mood.adv / total * 100}%`, bgcolor: "success.main" }} />
      <Box sx={{ width: `${flat / total * 100}%`, bgcolor: "text.disabled" }} />
      <Box sx={{ width: `${mood.dec / total * 100}%`, bgcolor: "error.main" }} />
    </Box>
    <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.5, fontSize: 12.5 }}>
      <Box component="span" sx={{ color: "success.main", fontWeight: 700 }}>▲ {mood.adv} up</Box>
      <Box component="span" sx={{ color: "text.secondary" }}>{flat} flat</Box>
      <Box component="span" sx={{ color: "error.main", fontWeight: 700 }}>▼ {mood.dec} down</Box>
    </Box>
    <Box sx={{ mt: 1.5, display: "grid", gap: 0.5, fontSize: 13 }}>
      <Box><Box component="span" sx={{ color: "text.secondary" }}>Money in: </Box><b>{inflow.join(", ") || "none clear"}</b></Box>
      <Box><Box component="span" sx={{ color: "text.secondary" }}>Money out: </Box><b>{outflow.join(", ") || "none clear"}</b></Box>
    </Box>
  </Box>;
}

function Headlines({ items }) {
  const now = Date.now();
  if (!items.length) return <Empty>No headlines yet.</Empty>;
  return <Box component="ol" sx={{ listStyle: "none", m: 0, p: 0 }}>
    {items.slice(0, 6).map(item => <Box component="li" key={item.id} sx={{ py: 0.75, borderBottom: 1, borderColor: "divider", "&:last-of-type": { borderBottom: 0 }, "&:first-of-type": { pt: 0 } }}>
      <Link href={item.url} target="_blank" rel="noopener noreferrer" underline="hover" color="inherit"
        sx={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.title}</Link>
      <Typography variant="caption" color="text.secondary">{item.source} · {timeAgo(item.published, now)}</Typography>
    </Box>)}
  </Box>;
}

const liveTag = live => <Tag color={live ? "success" : "default"} sx={{ py: 0, fontSize: 10.5 }}>{live ? "LIVE" : "RECORDED"}</Tag>;

export default function Overview({ boardApi, decisionApi, oiApi, newsApi, straddleApi, onOpen = () => {}, onOpenStocks }) {
  const board = useBoard(boardApi, { every: 15000 });
  const decision = usePolled(useCallback(signal => decisionApi.decision(signal), [decisionApi]), 60000);
  const news = usePolled(useCallback(signal => newsApi.load(signal), [newsApi]), 180000);
  const chain = useNiftyExpiry(oiApi, fetchChain, 30000);
  const straddle = useNiftyExpiry(straddleApi, fetchStraddle, 60000);

  const snapshot = board.snapshot;
  const stocks = useMemo(() => snapshot?.stocks || [], [snapshot]);
  const nifty = useMemo(() => snapshot ? contributions("NIFTY", snapshot) : { list: [], total: 0 }, [snapshot]);
  const cards = decision.data?.cards || [];
  const openStocks = () => (onOpenStocks ? onOpenStocks("nifty") : onOpen("index-stocks"));
  const boardNote = board.error || snapshot?.message;
  const asOf = snapshot?.asOf ? clock(snapshot.asOf) : null;
  const boardBody = content => !snapshot ? <Empty>{board.loading ? "Loading market data…" : boardNote || "Market data is unavailable right now."}</Empty> : content;
  const polled = (state, content, waiting = "Loading…") => state.data ? content(state.data) : <Empty>{state.error || waiting}</Empty>;
  const ups = nifty.list.filter(x => x.pts > 0).length, downs = nifty.list.filter(x => x.pts < 0).length;

  return <PageShell className="home-overview" maxWidth={1680}>
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1, mb: 1.25 }}>
      <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "1.4rem", md: "1.55rem" } }}>Market at a glance</Typography>
      <StatusChip snapshot={snapshot} error={board.error} />
      <Typography variant="body2" color="text.secondary">{asOf ? `As of ${asOf} IST · ` : ""}Click any box to open its full page.</Typography>
    </Box>
    <IndexStrip snapshot={snapshot} cards={cards} open={() => onOpen("market")} />
    <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))", lg: "repeat(3, minmax(0, 1fr))" },
      gridAutoRows: { md: "300px" } }}>
      <Tile title="Synopsis" note="Top movers · NIFTY 500 + F&O" page="money-flow" open={() => onOpen("money-flow")} bodySx={{ p: 1 }}>
        {boardBody(<Synopsis stocks={stocks} />)}
      </Tile>
      <Tile title="Option chain" page="oi-analysis" open={() => onOpen("oi-analysis")}
        note={chain.data ? <>NIFTY · {dayLabel(chain.data.expiry)} {liveTag(chain.data.live)}</> : "NIFTY"}>
        {polled(chain, data => <ChainSnippet chain={data} />)}
      </Tile>
      <Tile title="Index contributors · Stocks" page="index-stocks" open={openStocks}
        note={nifty.list.length ? <>NIFTY <Box component="span" sx={{ color: "success.main", fontWeight: 700 }}>+{ups}</Box> <Box component="span" sx={{ color: "error.main", fontWeight: 700 }}>−{downs}</Box></> : "NIFTY"}>
        {boardBody(<StockContributors list={nifty.list} />)}
      </Tile>
      <Tile title="Index contributors · Sectors" page="index-stocks" open={openStocks}
        note={nifty.list.length ? <>NIFTY <Box component="span" sx={{ ...mono, color: toneColor(nifty.total), fontWeight: 700 }}>{signed(nifty.total)} pts</Box></> : "NIFTY"}>
        {boardBody(<SectorContributors list={nifty.list} />)}
      </Tile>
      <Tile title="Global markets" note="US · Asia · Europe · commodities" page="market" open={() => onOpen("market")} bodySx={{ p: 0, overflow: "hidden" }}>
        <GlobalCues height={{ xs: 420, md: "100%" }} />
      </Tile>
      <Tile title="Latest news" note={news.data ? `${(news.data.news || []).length} stories` : ""} page="news" open={() => onOpen("news")}>
        {polled(news, data => <Headlines items={data.news || []} />)}
      </Tile>
      <Tile title="Index signals" note="Trend · big players · when to trade" page="index-analysis" open={() => onOpen("index-analysis")}>
        {polled(decision, data => <Signals cards={data.cards || []} />)}
      </Tile>
      <Tile title="Straddle" page="equity" open={() => onOpen("equity")}
        note={straddle.data ? <>NIFTY · {dayLabel(straddle.data.expiry)} {liveTag(straddle.data.live)}</> : "NIFTY"}>
        {polled(straddle, data => <StraddleSummary data={data} />)}
      </Tile>
      <Tile title="Market breadth" note={`${stocks.length || "--"} stocks`} page="market" open={() => onOpen("market")}>
        {boardBody(<Breadth stocks={stocks} snapshot={snapshot} />)}
      </Tile>
    </Box>
  </PageShell>;
}
