import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Box, Chip, Stack, Typography } from "@mui/material";
import { alpha, useTheme as useMuiTheme } from "@mui/material/styles";
import { FLOW_TAGS, analyse, breadthGroups, capRead, contributions, flowRead, inView, readLine, scanSetups, sectorFlow,
  segmentLabel, useBoard } from "../boardData";
import { BoardMessage, BuildTag, DOWN, FilterBar, NameButton, Panel, Pct, SegBadges, StatusChip, UP, toneColor, useBoardFilters } from "./boardUi";
import StockDrawer from "./stockDrawer";
import { PageShell, Segmented, mono } from "../ui/Glass";

const LOCK_KEY = "utraders-flow-sector";
const STRONG_CAP = 14;
const LOG_CAP = 80;
const SERIES_CAP = 500;
const MAX_DOTS = 320;
const FLOW_COLUMNS = "minmax(150px, 1.3fr) minmax(120px, 1.4fr) 70px 78px 56px 56px 64px 132px minmax(170px, 1.4fr)";
const STRONG_COLUMNS = "minmax(0, 1.5fr) auto 40px 34px 64px minmax(0, 1fr)";

const clockOf = seconds => new Date((seconds || Date.now() / 1000) * 1000)
  .toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
const fullClock = seconds => seconds ? new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" }) : "--";
const cr = value => `${value >= 0 ? "+" : ""}${Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)}`;
const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const seed = text => { let h = 0; for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 997; return h / 997; };

/** Bezier paths sector → condition → tunnel → strong row, measured from the rendered board (lg screens only). */
function measurePaths(board, A) {
  if (!board || typeof board.getBoundingClientRect !== "function") return [];
  const B = board.getBoundingClientRect();
  if (!B.width || board.clientWidth < 1100) return [];
  const rect = el => { const r = el.getBoundingClientRect(); return { l: r.left - B.left, r: r.right - B.left, t: r.top - B.top, h: r.height, cy: (r.top + r.bottom) / 2 - B.top }; };
  const sectors = {};
  board.querySelectorAll("[data-sector-row]").forEach(el => { sectors[el.dataset.sectorRow] = rect(el); });
  const tunnelEl = { bull: board.querySelector("[data-tunnel='bull']"), bear: board.querySelector("[data-tunnel='bear']") };
  if (!tunnelEl.bull || !tunnelEl.bear) return [];
  const tunnels = { bull: rect(tunnelEl.bull), bear: rect(tunnelEl.bear) };
  const rows = {};
  board.querySelectorAll("[data-strong-row]").forEach(el => { rows[`${el.dataset.side}|${el.dataset.sym}`] = rect(el); });
  const paths = [];
  A.conds.forEach((cond, ci) => {
    if (!cond.avail) return;
    const panel = board.querySelector(`[data-cond='${cond.id}']`);
    if (!panel) return;
    const P = rect(panel);
    [["bull", cond.bTop], ["bear", cond.sTop]].forEach(([side, list]) => list.forEach((x, i) => {
      const from = sectors[x.st.sector];
      if (!from) return;
      const y = P.t + P.h * (side === "bull" ? 0.32 : 0.68) + (i - list.length / 2) * 2.4;
      paths.push({ sym: x.st.sym, sector: x.st.sector, side, x0: from.r, y0: from.cy + (i % 5 - 2) * 1.6, x1: P.l, y1: y, ph: seed(x.st.sym + cond.id) });
      const T = tunnels[side];
      paths.push({ sym: x.st.sym, sector: x.st.sector, side, x0: P.r, y0: y, x1: T.l, y1: T.cy + (ci - 2.5) * 2.2 + (i - 5) * 0.6, ph: seed(cond.id + x.st.sym) });
    }));
  });
  [["bull", A.strongB], ["bear", A.strongS]].forEach(([side, list]) => list.slice(0, STRONG_CAP).forEach((st, i) => {
    const row = rows[`${side}|${st.sym}`];
    if (!row) return;
    const T = tunnels[side];
    paths.push({ sym: st.sym, sector: st.sector, side, x0: T.r, y0: T.cy + (i - list.length / 2) * 1.2, x1: row.l, y1: row.cy, ph: seed(st.sym), strong: true });
  }));
  return paths.map(p => {
    const dx = (p.x1 - p.x0) * 0.5;
    return { ...p, d: `M${p.x0.toFixed(1)} ${p.y0.toFixed(1)} C${(p.x0 + dx).toFixed(1)} ${p.y0.toFixed(1)}, ${(p.x1 - dx).toFixed(1)} ${p.y1.toFixed(1)}, ${p.x1.toFixed(1)} ${p.y1.toFixed(1)}` };
  });
}

function FlowLines({ paths, highlight }) {
  const theme = useMuiTheme();
  const motion = !reducedMotion();
  if (!paths.length) return null;
  const match = p => !highlight || (highlight.sym ? p.sym === highlight.sym : p.sector === highlight.sector);
  const color = side => (side === "bull" ? theme.palette.success.main : theme.palette.error.main);
  return <Box component="svg" aria-hidden="true" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 0,
    display: { xs: "none", xl: "block" }, overflow: "visible" }}>
    {paths.map((p, i) => {
      const on = match(p);
      return <path key={`p${i}`} d={p.d} fill="none" stroke={color(p.side)} strokeWidth={highlight && on ? 1.7 : 1}
        strokeOpacity={highlight ? (on ? 0.9 : 0.035) : (p.strong ? 0.5 : 0.17)} />;
    })}
    {motion && paths.slice(0, MAX_DOTS).map((p, i) => (highlight && !match(p) ? null
      : <circle key={`d${i}`} r="1.6" fill={theme.palette.text.primary} fillOpacity="0.85">
        <animateMotion dur="5s" repeatCount="indefinite" begin={`-${(p.ph * 5).toFixed(2)}s`} path={p.d} />
      </circle>))}
  </Box>;
}

function DivergingBar({ value, max, height = 6 }) {
  const width = max ? Math.min(50, Math.abs(value) / max * 50) : 0;
  return <Box sx={{ position: "relative", height, borderRadius: 1, bgcolor: "action.hover", overflow: "hidden" }}>
    <Box sx={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "1px", bgcolor: "divider" }} />
    <Box sx={{ position: "absolute", top: 0, bottom: 0, left: `${value >= 0 ? 50 : 50 - width}%`, width: `${width}%`, bgcolor: value >= 0 ? UP : DOWN, opacity: 0.85 }} />
  </Box>;
}

function SectorsPanel({ A, lock, onLock, onHover }) {
  const top = Math.max(1, ...A.sectors.map(s => Math.abs(s.net)));
  return <Panel title="1 · Sectors" note={`${A.rows.length} names`} aria-label="Sectors">
    {A.sectors.length ? A.sectors.map(s => {
      const on = lock?.sector === s.sector;
      return <Box key={s.sector} component="button" type="button" data-sector-row={s.sector} aria-pressed={on}
        onClick={() => onLock(on ? null : { sector: s.sector })} onMouseEnter={() => onHover({ sector: s.sector })} onMouseLeave={() => onHover(null)}
        title={`${s.sector}: click to ${on ? "stop tracing" : "trace its money on the board"}`}
        sx={{ all: "unset", boxSizing: "border-box", width: "100%", cursor: "pointer", display: "grid", gridTemplateColumns: "minmax(0, 1fr) 22px 40px 28px",
          alignItems: "center", gap: 0.6, px: 0.6, py: 0.4, borderRadius: 1.5, fontSize: 12,
          bgcolor: on ? "action.selected" : "transparent", "&:hover, &:focus-visible": { bgcolor: "action.hover" } }}>
        <Box component="span" sx={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: on ? 800 : 600 }}>{s.sector}</Box>
        <Box component="span" sx={{ color: "text.secondary", textAlign: "right", ...mono }}>{s.n}</Box>
        <DivergingBar value={s.net} max={top} />
        <Box component="span" sx={{ ...mono, textAlign: "right", fontWeight: 800, color: toneColor(s.net) }}>{s.net > 0 ? "+" : ""}{s.net}</Box>
      </Box>;
    }) : <Typography variant="body2" color="text.secondary">No names in view.</Typography>}
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>net = bull lists − bear lists · click to trace</Typography>
  </Panel>;
}

function ConditionPanel({ cond, number, onPick, onHover }) {
  const title = `${number} · ${cond.name}`;
  if (!cond.avail) {
    return <Panel title={title} note={cond.sub} data-cond={cond.id} aria-label={cond.name}>
      <Typography variant="body2" color="text.secondary">Off: needs {cond.need || "more data"}.</Typography>
    </Panel>;
  }
  const nb = cond.bulls.length, ns = cond.bears.length;
  const list = (items, side) => items.length ? items.slice(0, 3).map((x, i) => <Box key={x.st.sym}
    onMouseEnter={() => onHover({ sym: x.st.sym })} onMouseLeave={() => onHover(null)}
    sx={{ display: "grid", gridTemplateColumns: "12px minmax(0, 1fr) auto", gap: 0.5, alignItems: "center", fontSize: 11.5, py: 0.2 }}>
    <Box component="span" sx={{ color: "text.secondary", ...mono, textAlign: "right" }}>{i + 1}</Box>
    <NameButton st={x.st} onPick={onPick} />
    <Box component="span" sx={{ ...mono, color: side === "bull" ? UP : DOWN }}>{cond.fmt(x.v, x.st)}</Box>
  </Box>) : <Typography variant="caption" color="text.secondary">—</Typography>;
  return <Panel title={title} note={cond.sub} data-cond={cond.id} aria-label={cond.name}>
    <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 1, alignItems: "center", mb: 0.75 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 800, color: UP }}>BULLS {nb}</Typography>
      <Box sx={{ height: 5, borderRadius: 1, bgcolor: DOWN, overflow: "hidden" }}>
        <Box sx={{ height: "100%", width: `${nb + ns ? nb / (nb + ns) * 100 : 50}%`, bgcolor: UP }} />
      </Box>
      <Typography sx={{ fontSize: 11, fontWeight: 800, color: DOWN }}>BEARS {ns}</Typography>
    </Box>
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
      <Box>{list(cond.bTop, "bull")}</Box><Box>{list(cond.sTop, "bear")}</Box>
    </Box>
  </Panel>;
}

function Tunnel({ side, count }) {
  const bull = side === "bull";
  return <Box data-tunnel={side} role="group" aria-label={bull ? "Bullish names" : "Bearish names"}
    sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, px: 1.5, py: 1.25, borderRadius: 2, border: 1,
      borderColor: bull ? "success.main" : "error.main", bgcolor: theme => alpha(theme.palette[bull ? "success" : "error"].main, 0.08) }}>
    <Box>
      <Typography sx={{ fontWeight: 900, letterSpacing: 1, color: bull ? UP : DOWN }}>{bull ? "▲ BULLISH" : "▼ BEARISH"}</Typography>
      <Typography variant="caption" color="text.secondary">names in ≥1 {side} list</Typography>
    </Box>
    <Typography sx={{ ...mono, fontSize: 26, fontWeight: 900, color: bull ? UP : DOWN }}>{count}</Typography>
  </Box>;
}

function BreadthPanel({ stocks }) {
  const groups = breadthGroups(stocks);
  const all = groups[0] || { up: 0, down: 0 };
  const ratio = all.down ? (all.up / all.down).toFixed(2) : all.up ? "∞" : "—";
  return <Panel title="Market breadth" note={`A/D ${ratio}`} aria-label="Market breadth">
    {groups.map(g => {
      const n = g.n || 1;
      return <Box key={g.label} sx={{ display: "grid", gridTemplateColumns: "72px 1fr 64px", gap: 1, alignItems: "center", fontSize: 12, py: 0.25 }}>
        <Box component="span" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{g.label}</Box>
        <Box sx={{ display: "flex", height: 7, borderRadius: 1, overflow: "hidden", bgcolor: "action.hover" }}>
          <Box sx={{ width: `${g.up / n * 100}%`, bgcolor: UP }} />
          <Box sx={{ width: `${g.flat / n * 100}%`, bgcolor: "text.disabled", opacity: 0.35 }} />
          <Box sx={{ width: `${g.down / n * 100}%`, bgcolor: DOWN }} />
        </Box>
        <Box component="span" sx={{ ...mono, textAlign: "right" }}><Box component="span" sx={{ color: UP }}>{g.up}</Box> / <Box component="span" sx={{ color: DOWN }}>{g.down}</Box></Box>
      </Box>;
    })}
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>{capRead(groups)}</Typography>
  </Panel>;
}

function MoversPanel({ snapshot, indexKey, onIndex, onPick }) {
  const C = contributions(indexKey, snapshot);
  const label = indexKey === "SENSEX" ? "SENSEX" : "NIFTY";
  const max = Math.max(1e-9, ...C.list.map(x => Math.abs(x.pts)));
  const up = C.list.filter(x => x.pts > 0).sort((a, b) => b.pts - a.pts).slice(0, 5);
  const down = C.list.filter(x => x.pts < 0).sort((a, b) => a.pts - b.pts).slice(0, 5);
  const row = x => <Box key={x.st.sym} sx={{ position: "relative", display: "grid", gridTemplateColumns: "minmax(0, 1fr) 58px 64px", gap: 0.5, alignItems: "center", fontSize: 12, py: 0.35 }}>
    <Box sx={{ minWidth: 0, display: "flex", gap: 0.5, alignItems: "baseline" }}>
      <NameButton st={x.st} onPick={onPick} />
      {Number.isFinite(x.weight) && <Box component="span" sx={{ color: "text.secondary", fontSize: 10.5 }}>{x.weight.toFixed(1)}%</Box>}
    </Box>
    <Pct value={x.st.pc} sx={{ textAlign: "right" }} />
    <Box component="span" sx={{ ...mono, textAlign: "right", fontWeight: 800, color: toneColor(x.pts) }}>{x.pts >= 0 ? "+" : ""}{x.pts.toFixed(1)} pts</Box>
    <Box sx={{ position: "absolute", left: 0, bottom: 0, height: 2, width: `${Math.abs(x.pts) / max * 100}%`, bgcolor: x.pts >= 0 ? UP : DOWN, opacity: 0.6 }} />
  </Box>;
  const index = C.index;
  const moved = index && Number.isFinite(index.ltp) && Number.isFinite(index.prev) ? index.ltp - index.prev : NaN;
  return <Panel title="Who moves the index" aria-label="Who moves the index"
    actions={<Segmented label="Index for contributions" value={indexKey} onChange={onIndex} options={[["NIFTY", "NIFTY"], ["SENSEX", "SENSEX"]]} />}>
    {!C.list.length ? <Typography variant="body2" color="text.secondary">
      No {label} stock weights yet. They are refitted from Zerodha minute prices each trading morning.
    </Typography> : <>
      <Box sx={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 1, fontSize: 12, mb: 0.75 }}>
        <span>{label} <Pct value={index?.pc} sx={{ fontWeight: 800 }} />{Number.isFinite(moved) && <Box component="span" sx={{ color: "text.secondary" }}> ({moved >= 0 ? "+" : ""}{moved.toFixed(0)} pts)</Box>}</span>
        <span><Box component="span" sx={{ color: UP }}>{C.list.filter(x => x.st.pc > 0.1).length}</Box> up · <Box component="span" sx={{ color: DOWN }}>{C.list.filter(x => x.st.pc < -0.1).length}</Box> down</span>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", xl: "1fr" }, gap: 1 }}>
        <Box><Typography sx={{ fontSize: 10.5, fontWeight: 800, color: UP, mb: 0.25 }}>▲ PUSHING UP</Typography>{up.length ? up.map(row) : <Typography variant="caption" color="text.secondary">—</Typography>}</Box>
        <Box><Typography sx={{ fontSize: 10.5, fontWeight: 800, color: DOWN, mb: 0.25 }}>▼ DRAGGING DOWN</Typography>{down.length ? down.map(row) : <Typography variant="caption" color="text.secondary">—</Typography>}</Box>
      </Box>
    </>}
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>points = fitted index weight × stock move · click a name for its card</Typography>
  </Panel>;
}

function SignalLog({ log, nAvail, onPick }) {
  return <Panel title="Signal log" note="newest first" aria-label="Signal log">
    <Box sx={{ maxHeight: 190, overflowY: "auto", fontSize: 12 }}>
      {log.length ? log.slice(0, 40).map((entry, i) => entry.act === "view"
        ? <Box key={i} sx={{ color: "text.secondary", py: 0.2 }}>{entry.t} — view switched to {entry.view} —</Box>
        : <Box key={i} sx={{ display: "flex", gap: 1, py: 0.2 }}>
          <Box component="span" sx={{ color: "text.secondary", ...mono }}>{entry.t}</Box>
          <span><NameButton st={{ sym: entry.sym }} onPick={onPick} sx={{ color: entry.side === "bull" ? UP : DOWN }} /> {entry.act} the strong {entry.side}s{entry.act === "joined" ? ` (${entry.n}/${nAvail})` : ""}</span>
        </Box>)
        : <Typography variant="body2" color="text.secondary">Changes in the strong lists will appear here.</Typography>}
    </Box>
  </Panel>;
}

function DayChart({ series }) {
  const theme = useMuiTheme();
  const max = Math.max(3, ...series.map(x => Math.max(x.b, x.s)));
  const points = key => series.map((x, i) => `${(series.length > 1 ? i / (series.length - 1) : 0) * 300},${(77 - x[key] / max * 72).toFixed(1)}`).join(" ");
  return <Panel title="The day" note={`${series.length} update${series.length === 1 ? "" : "s"} since you opened this page`} aria-label="The day">
    <Box component="svg" viewBox="0 0 300 80" preserveAspectRatio="none" role="img" aria-label="Strong bulls and bears over time"
      sx={{ width: "100%", height: 80, display: "block" }}>
      <line x1="0" y1="79" x2="300" y2="79" stroke="currentColor" strokeOpacity="0.2" />
      {series.length > 1 && <>
        <polyline points={points("b")} fill="none" stroke={theme.palette.success.main} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <polyline points={points("s")} fill="none" stroke={theme.palette.error.main} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </>}
    </Box>
    <Typography variant="caption"><Box component="span" sx={{ color: UP }}>━ strong bulls</Box> &nbsp; <Box component="span" sx={{ color: DOWN }}>━ strong bears</Box></Typography>
  </Panel>;
}

function StrongTable({ side, A, lock, onPick, onHover }) {
  const bull = side === "bull";
  const list = bull ? A.strongB : A.strongS;
  const near = bull ? A.nearB : A.nearS;
  const available = A.conds.filter(cond => cond.avail);
  const title = <Box component="span" sx={{ color: bull ? UP : DOWN, fontWeight: 900, letterSpacing: 1 }}>{bull ? "▲ STRONG BULLS" : "▼ STRONG BEARS"}</Box>;
  return <Panel title={title} aria-label={bull ? "Strong bulls" : "Strong bears"} note={`${list.length} names · ${A.need}+ of ${A.nAvail} conditions`}>
    <Box sx={{ display: "grid", gridTemplateColumns: STRONG_COLUMNS, gap: 1, fontSize: 10.5, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", pb: 0.5, borderBottom: 1, borderColor: "divider" }}>
      <span>Name</span><span>Agree</span><span>N</span><span>Build</span><Box component="span" sx={{ textAlign: "right" }}>Chg</Box><span>Sector</span>
    </Box>
    <Box role="list" aria-label={bull ? "Strong bull names" : "Strong bear names"}>
    {list.length ? list.slice(0, STRONG_CAP).map(st => {
      const M = A.mem[st.sym][side];
      const traced = lock?.sector === st.sector;
      return <Box key={st.sym} data-strong-row="" data-side={side} data-sym={st.sym} role="listitem" aria-label={st.sym}
        onMouseEnter={() => onHover({ sym: st.sym })} onMouseLeave={() => onHover(null)}
        sx={{ display: "grid", gridTemplateColumns: STRONG_COLUMNS, gap: 1, alignItems: "center", fontSize: 12.5, py: 0.45, px: 0.25,
          borderBottom: 1, borderColor: "divider", bgcolor: traced ? "action.selected" : "transparent", "&:hover": { bgcolor: "action.hover" } }}>
        <Box sx={{ minWidth: 0, display: "flex", alignItems: "center" }}><NameButton st={st} onPick={onPick} /><SegBadges st={st} /></Box>
        <Box component="span" sx={{ display: "inline-flex", gap: "3px" }}>
          {available.map(cond => <Box key={cond.id} component="i" title={`${cond.name}: ${M.has(cond.id) ? `in the ${side} list` : "not in the list"}`}
            sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: M.has(cond.id) ? (bull ? UP : DOWN) : "transparent", border: 1,
              borderColor: M.has(cond.id) ? "transparent" : "text.disabled" }} />)}
        </Box>
        <Box component="span" sx={mono}>{M.size}/{A.nAvail}</Box>
        <BuildTag code={st.b} />
        <Pct value={st.pc} sx={{ textAlign: "right", fontWeight: 700 }} />
        <Box component="span" sx={{ color: "text.secondary", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{st.sector}</Box>
      </Box>;
    }) : <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>No name is in enough {side} lists yet.</Typography>}
    </Box>
    {list.length > STRONG_CAP && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>+{list.length - STRONG_CAP} more</Typography>}
    {near.length > 0 && <Box sx={{ mt: 1, fontSize: 12, display: "flex", flexWrap: "wrap", gap: 1.25, alignItems: "baseline" }}>
      <Typography component="b" sx={{ fontSize: 10.5, fontWeight: 800, color: "warning.main" }}>ONE LIST AWAY</Typography>
      {near.slice(0, 6).map(st => <span key={st.sym}><NameButton st={st} onPick={onPick} /> <Box component="span" sx={{ color: "text.secondary", ...mono }}>{A.mem[st.sym][side].size}/{A.nAvail}</Box></span>)}
    </Box>}
  </Panel>;
}

const VERDICT_STYLE = { in: ["success", "filled"], acc: ["success", "outlined"], neu: ["default", "outlined"], dis: ["error", "outlined"], out: ["error", "filled"] };

function SectorFlowTable({ flows, lock, onLock, onPick }) {
  const max = Math.max(1e-9, ...flows.map(o => Math.abs(o.flow)));
  const head = ["Sector", "Money flow today", "₹ Cr", "Last 30m", ">VWAP", "LB/SB", "Up/Dn", "Verdict", "Leader · laggard"];
  return <Panel title={<Box component="span" sx={{ color: "warning.main", fontWeight: 900, letterSpacing: 1 }}>₹ SECTOR SMART-MONEY FLOW</Box>}
    note="signed turnover · click a sector to trace it on the board" aria-label="Sector smart-money flow" sx={{ mt: 2 }}>
    <Typography variant="body2" sx={{ mb: 1, px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: "action.hover" }}>{flowRead(flows)}</Typography>
    <Box sx={{ overflowX: "auto" }}>
      <Box role="table" aria-label="Sector money flow" sx={{ minWidth: 980 }}>
        <Box role="row" sx={{ display: "grid", gridTemplateColumns: FLOW_COLUMNS, gap: 1, fontSize: 10.5, color: "text.secondary", fontWeight: 700, textTransform: "uppercase", pb: 0.5, borderBottom: 1, borderColor: "divider" }}>
          {head.map((label, i) => <Box key={label} role="columnheader" sx={{ textAlign: i >= 2 && i <= 6 ? "right" : "left" }}>{label}</Box>)}
        </Box>
        {flows.length ? flows.map(o => {
          const on = lock?.sector === o.sector;
          const [color, variant] = VERDICT_STYLE[o.tag];
          return <Box key={o.sector} role="row" aria-label={o.sector} aria-selected={on} tabIndex={0}
            onClick={() => onLock(on ? null : { sector: o.sector })}
            onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onLock(on ? null : { sector: o.sector }); } }}
            sx={{ display: "grid", gridTemplateColumns: FLOW_COLUMNS, gap: 1, alignItems: "center", fontSize: 12.5, py: 0.6, px: 0.25, cursor: "pointer",
              borderBottom: 1, borderColor: "divider", bgcolor: on ? "action.selected" : "transparent", "&:hover, &:focus-visible": { bgcolor: "action.hover" } }}>
            <Box role="cell" sx={{ fontWeight: 700, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.sector} <Box component="span" sx={{ color: "text.secondary", fontWeight: 400 }}>{o.n}</Box></Box>
            <Box role="cell"><DivergingBar value={o.flow} max={max} height={8} /></Box>
            <Box role="cell" sx={{ ...mono, textAlign: "right", color: toneColor(o.flow), fontWeight: 700 }}>₹{cr(o.flow)}</Box>
            <Box role="cell" sx={{ ...mono, textAlign: "right", color: toneColor(o.flow30) }}>{o.flow30 >= 0 ? "↗" : "↘"} {cr(o.flow30)}</Box>
            <Box role="cell" sx={{ ...mono, textAlign: "right" }}>{Math.round(o.vwP * 100)}%</Box>
            <Box role="cell" sx={{ ...mono, textAlign: "right" }}>{o.fno ? <><Box component="span" sx={{ color: UP }}>{o.lb}</Box>/<Box component="span" sx={{ color: DOWN }}>{o.sb}</Box></> : <Box component="span" sx={{ color: "text.secondary" }}>—</Box>}</Box>
            <Box role="cell" sx={{ ...mono, textAlign: "right" }}><Box component="span" sx={{ color: UP }}>{o.up}</Box>/<Box component="span" sx={{ color: DOWN }}>{o.down}</Box></Box>
            <Box role="cell"><Chip size="small" color={color} variant={variant} label={FLOW_TAGS[o.tag]} sx={{ fontWeight: 800, fontSize: 10.5, height: 20 }} /></Box>
            <Box role="cell" sx={{ minWidth: 0, display: "flex", gap: 0.5, alignItems: "baseline", whiteSpace: "nowrap", overflow: "hidden" }} onClick={event => event.stopPropagation()}>
              <NameButton st={o.best} onPick={onPick} sx={{ color: UP }} /><Pct value={o.best.pc} sx={{ fontSize: 11 }} /><span>·</span>
              <NameButton st={o.worst} onPick={onPick} sx={{ color: DOWN }} /><Pct value={o.worst.pc} sx={{ fontSize: 11 }} />
            </Box>
          </Box>;
        }) : <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>No sectors in view.</Typography>}
      </Box>
    </Box>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
      Money flow adds up traded value, positive when a trade prints on an up-tick and negative on a down-tick. <b>Smart money in</b> = strong
      inflow + most stocks above VWAP + long build-up beating short build-up. Delivery % is not available from Zerodha, so the verdict
      rests on flow, VWAP and futures build-up. LB/SB = F&O stocks in long vs short build-up.
    </Typography>
  </Panel>;
}

export default function MoneyFlow({ api }) {
  const { snapshot, scan, error } = useBoard(api, { scannerBars: 3 });
  const [filter, setFilter] = useBoardFilters();
  const [pick, setPick] = useState(null);
  const [lock, setLock] = useState(null);
  const [hover, setHover] = useState(null);
  const [indexKey, setIndexKey] = useState("NIFTY");
  const [log, setLog] = useState([]);
  const [series, setSeries] = useState([]);
  const [paths, setPaths] = useState([]);
  const board = useRef(null);
  const tracking = useRef({ prev: null, view: null, at: null });

  useEffect(() => {
    let sector = null;
    try { sector = sessionStorage.getItem(LOCK_KEY); sessionStorage.removeItem(LOCK_KEY); } catch { /* storage unavailable */ }
    if (sector) setLock({ sector });
  }, []);

  const stocks = useMemo(() => snapshot?.stocks || [], [snapshot]);
  const picks = useMemo(() => new Set(scanSetups(stocks, scan || {}, {}).map(o => o.st.sym)), [stocks, scan]);
  const rows = useMemo(() => stocks.filter(st => inView(st, filter.segment, filter.cap, picks)), [stocks, filter.segment, filter.cap, picks]);
  const A = useMemo(() => analyse(rows), [rows]);
  const flows = useMemo(() => sectorFlow(rows), [rows]);
  const view = segmentLabel(filter.segment, filter.cap);
  const clock = clockOf(snapshot?.asOf);

  // Who joined or dropped out of the strong lists, and how many there were, at each new snapshot.
  useEffect(() => {
    if (!snapshot) return;
    const state = tracking.current;
    const stamp = `${snapshot.asOf}|${view}`;
    if (state.at === stamp) return;
    const t = clockOf(snapshot.asOf);
    const entries = [];
    if (state.view !== null && state.view !== view) {
      entries.push({ t, act: "view", view });
      state.prev = null;
    }
    const current = { bull: new Set(A.strongB.map(st => st.sym)), bear: new Set(A.strongS.map(st => st.sym)) };
    if (state.prev) {
      ["bull", "bear"].forEach(side => {
        current[side].forEach(sym => { if (!state.prev[side].has(sym)) entries.push({ t, sym, side, act: "joined", n: A.mem[sym][side].size }); });
        state.prev[side].forEach(sym => { if (!current[side].has(sym)) entries.push({ t, sym, side, act: "dropped out of" }); });
      });
    }
    state.prev = current;
    state.view = view;
    state.at = stamp;
    if (entries.length) setLog(previous => [...entries.reverse(), ...previous].slice(0, LOG_CAP));
    setSeries(previous => [...previous, { b: current.bull.size, s: current.bear.size }].slice(-SERIES_CAP));
  }, [snapshot, A, view]);

  const remeasure = useCallback(() => {
    const next = measurePaths(board.current, A);
    setPaths(previous => (previous.length === next.length && previous.every((p, i) => p.d === next[i].d && p.sym === next[i].sym) ? previous : next));
  }, [A]);
  useLayoutEffect(() => { remeasure(); }, [remeasure]);
  useEffect(() => {
    const element = board.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => remeasure());
    observer.observe(element);
    return () => observer.disconnect();
  }, [remeasure]);

  const highlight = hover || lock;
  const read = readLine(A, view, clock);
  const status = !snapshot && !error ? "Loading market data…" : "";

  return <PageShell className="money-flow" maxWidth={1760}>
    <Stack direction={{ xs: "column", md: "row" }} spacing={1} justifyContent="space-between" alignItems={{ md: "center" }} sx={{ mb: 1.5 }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="h1" component="h1" sx={{ fontSize: { xs: "1.4rem", md: "1.55rem" } }}>Money Flow</Typography>
          <StatusChip snapshot={snapshot} error={error} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          Where the money is going: sectors → seven signal lists → names most lists agree on · as of {fullClock(snapshot?.asOf)} IST
        </Typography>
      </Box>
      {lock && <Chip label={`Tracing ${lock.sector}`} onDelete={() => setLock(null)} color="warning" variant="outlined" size="small" />}
    </Stack>
    <FilterBar filter={filter} onChange={setFilter} shown={snapshot ? rows.length : undefined} total={stocks.length} />
    <BoardMessage snapshot={snapshot} error={error} />
    {status && <Typography role="status" variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{status}</Typography>}

    <Box component="section" aria-label="What the board sees" sx={{ display: "flex", gap: 1.5, mb: 2, px: 1.5, py: 1, borderRadius: 2, borderLeft: 3,
      borderColor: "warning.main", bgcolor: "background.paper", fontSize: 13 }}>
      <Typography component="b" sx={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, color: "warning.main", whiteSpace: "nowrap", pt: "2px" }}>WHAT THE BOARD SEES</Typography>
      <Typography variant="body2"><Box component="span" sx={{ color: A.strongB.length ? UP : "text.primary" }}>{read.bulls}</Box>{" "}
        <Box component="span" sx={{ color: A.strongS.length ? DOWN : "text.primary" }}>{read.bears}</Box>{" "}{read.tape}</Typography>
    </Box>

    {/* Four columns with room for the flow lines only on wide screens (the sidebar takes up to 240px); two below that. */}
    <Box ref={board} sx={{ position: "relative", display: "grid", alignItems: "start", rowGap: 1.5, columnGap: { xs: 1.5, xl: 6 },
      gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))",
        xl: "minmax(220px, 270px) minmax(300px, 360px) minmax(220px, 260px) minmax(380px, 1fr)" } }}>
      <FlowLines paths={paths} highlight={highlight} />
      <Box sx={{ position: "relative", zIndex: 1, minWidth: 0 }}>
        <SectorsPanel A={A} lock={lock} onLock={setLock} onHover={setHover} />
      </Box>
      <Stack spacing={1.25} sx={{ position: "relative", zIndex: 1, minWidth: 0 }}>
        {A.conds.map((cond, i) => <ConditionPanel key={cond.id} cond={cond} number={i + 2} onPick={setPick} onHover={setHover} />)}
      </Stack>
      <Stack spacing={1.25} sx={{ position: "relative", zIndex: 1, minWidth: 0 }}>
        <Tunnel side="bull" count={A.inBull} />
        <Tunnel side="bear" count={A.inBear} />
        <BreadthPanel stocks={stocks} />
        <MoversPanel snapshot={snapshot || { idx: {}, bySym: {}, weights: {} }} indexKey={indexKey} onIndex={setIndexKey} onPick={setPick} />
        <SignalLog log={log} nAvail={A.nAvail} onPick={setPick} />
        <DayChart series={series} />
      </Stack>
      <Stack spacing={1.25} sx={{ position: "relative", zIndex: 1, minWidth: 0 }}>
        <StrongTable side="bull" A={A} lock={lock} onPick={setPick} onHover={setHover} />
        <StrongTable side="bear" A={A} lock={lock} onPick={setPick} onHover={setHover} />
      </Stack>
    </Box>

    <SectorFlowTable flows={flows} lock={lock} onLock={setLock} onPick={setPick} />

    <Typography component="footer" variant="caption" color="text.secondary" sx={{ display: "block", mt: 2 }}>
      view: {view} · rule: top {A.TOPN} per condition · OI build-up applies to F&O names · a name in {A.need}+ bull lists (and fewer bear lists) is a
      strong bull, same for bears · green bull · red bear · hover a name to trace its path · click a name for its card · information only, not investment advice
    </Typography>

    <StockDrawer sym={pick} snapshot={snapshot} scan={scan} analysis={A} api={api} onClose={() => setPick(null)} />
  </PageShell>;
}

export { measurePaths };
