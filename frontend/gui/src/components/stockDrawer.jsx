import React, { useEffect, useMemo, useState } from "react";
import { Box, Drawer, IconButton, Typography } from "@mui/material";
import { X } from "lucide-react";
import LiveChart from "./liveChart";
import { BUILD, CONDS, INDICATORS, analyse, contributions, crore, fp, fpc, isNum, pctOf, signedCrore, stockLevels } from "../boardData";
import { BuildTag, DOWN, UP, toneColor } from "./boardUi";
import { mono } from "../ui/Glass";

function Row({ label, value, color, wide }) {
  return <Box sx={{ gridColumn: wide ? "1 / -1" : "auto", minWidth: 0 }}>
    <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontWeight: 700 }}>{label}</Typography>
    <Typography sx={{ ...mono, fontSize: 13.5, fontWeight: 700, color: color || "text.primary" }}>{value}</Typography>
  </Box>;
}

function useCandles(api, sym) {
  const [state, setState] = useState({ candles: [], message: "Loading chart…" });
  useEffect(() => {
    if (!sym || !api?.candles) return undefined;
    let stopped = false;
    let timer = null;
    const abort = new AbortController();
    setState({ candles: [], message: "Loading chart…" });
    const run = async () => {
      let delay = 60000;
      try {
        const data = await api.candles(sym, abort.signal);
        if (stopped) return;
        setState({ candles: data.candles || [], message: data.message || (data.candles?.length ? "" : "No candles for this session yet.") });
        if (data.retryAfterMs) delay = Math.max(1000, data.retryAfterMs);
      } catch (exc) {
        if (!stopped && exc.name !== "AbortError") setState({ candles: [], message: exc.message });
      }
      if (!stopped) timer = setTimeout(run, delay);
    };
    run();
    return () => { stopped = true; abort.abort(); clearTimeout(timer); };
  }, [api, sym]);
  return state;
}

/** The stock card: price, chart, where it stands in each board list, levels and the intraday checklist. */
export default function StockDrawer({ sym, snapshot, scan = {}, analysis, api, onClose }) {
  const st = sym ? snapshot?.bySym?.[sym] : null;
  const board = useMemo(() => analysis || (snapshot?.stocks?.length ? analyse(snapshot.stocks) : null), [analysis, snapshot]);
  const { candles, message } = useCandles(api, st ? sym : null);
  const open = Boolean(st);
  let body = null;
  if (st) {
    const levels = stockLevels(st);
    const member = board?.mem?.[st.sym] || { bull: new Set(), bear: new Set() };
    const build = BUILD[st.b];
    const nifty = contributions("NIFTY", snapshot).list.find(x => x.st.sym === st.sym);
    const q = scan[st.sym];
    const vwapGap = pctOf(st.ltp, st.vwap);
    const memberships = [st.sx && "Sensex 30", st.n50 && "Nifty 50", st.n500 ? "Nifty 500" : "outside Nifty 500"].filter(Boolean);
    body = <>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h2" sx={{ fontSize: 20, fontWeight: 850 }}>{st.sym}</Typography>
          <Typography variant="caption" color="text.secondary">
            {[st.company, st.sector, st.fno ? "F&O stock" : "cash only", st.cap && `${st.cap} cap`, ...memberships,
              nifty && Number.isFinite(nifty.weight) && `Nifty weight ${nifty.weight.toFixed(2)}%`].filter(Boolean).join(" · ")}
          </Typography>
        </Box>
        <IconButton aria-label="Close stock card" onClick={onClose} size="small"><X size={18} /></IconButton>
      </Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 1, flexWrap: "wrap" }}>
        <Typography sx={{ ...mono, fontSize: 26, fontWeight: 850 }}>{fp(st.ltp)}</Typography>
        <Typography sx={{ ...mono, fontWeight: 800, color: toneColor(st.pc) }}>{fpc(st.pc)}</Typography>
        <BuildTag code={st.b} /><Typography variant="body2" color="text.secondary">{build.name}</Typography>
      </Box>
      <Box sx={{ position: "relative", height: 210, mt: 1, borderRadius: 2, overflow: "hidden", border: 1, borderColor: "divider" }}>
        <LiveChart candles={candles} live={null} interval="minute" precision={2} label={st.sym} />
        {!candles.length && <Typography role="status" color="text.secondary" sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 13, pointerEvents: "none" }}>{message}</Typography>}
      </Box>
      <Typography component="h3" sx={{ mt: 2, mb: 0.5, fontSize: 12, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase" }}>
        Board conditions <Box component="span" sx={{ color: "text.secondary", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>· bull {member.bull.size} · bear {member.bear.size}</Box>
      </Typography>
      {CONDS.map(cond => {
        const value = cond.score(st);
        const avail = board?.conds?.find(c => c.id === cond.id)?.avail && isNum(value);
        const place = !avail ? ["off", "text.disabled"] : member.bull.has(cond.id) ? ["● bull list", UP] : member.bear.has(cond.id) ? ["● bear list", DOWN] : ["○ not ranked", "text.secondary"];
        return <Box key={cond.id} sx={{ display: "grid", gridTemplateColumns: "1fr auto 96px", gap: 1, py: 0.4, borderBottom: 1, borderColor: "divider", fontSize: 12.5 }}>
          <span>{cond.name}</span><Box component="span" sx={{ color: place[1], fontWeight: 700 }}>{place[0]}</Box>
          <Box component="span" sx={{ ...mono, textAlign: "right", color: avail ? toneColor(value) : "text.disabled" }}>{avail ? cond.fmt(value, st) : "—"}</Box>
        </Box>;
      })}
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.25, mt: 1.5 }}>
        <Row label="Support" value={fp(levels?.sup)} color={UP} />
        <Row label="Resistance" value={fp(levels?.res)} color={DOWN} />
        {st.fno
          ? <><Row label="Futures OI" value={isNum(st.oi) ? st.oi.toLocaleString("en-IN") : "--"} /><Row label="OI change" value={fpc(st.oc)} color={toneColor(st.oc)} /></>
          : <><Row label="Volume" value={isNum(st.volume) ? st.volume.toLocaleString("en-IN") : "--"} /><Row label="Vs normal pace" value={isNum(st.surge) ? `${st.surge.toFixed(1)}×` : "--"} /></>}
        <Row label="Day high / low" value={`${fp(st.high)} / ${fp(st.low)}`} />
        <Row label="Prev close" value={fp(st.prev)} />
        <Row label="VWAP" value={`${fp(st.vwap)} (${fpc(vwapGap)})`} color={toneColor(vwapGap)} />
        <Row label="52-week range" value={`${fp(st.lo52)} – ${fp(st.hi52)}`} />
        <Row label="Money flow today" value={`₹${signedCrore(st.flow)} Cr`} color={toneColor(st.flow)} />
        <Row label="Last 30 min" value={`₹${signedCrore(st.flow30)} Cr`} color={toneColor(st.flow30)} />
        <Row label="Traded today" value={`₹${crore(st.value)} Cr`} />
        {!st.fno && isNum(st.uc) && <Row label="Circuit band" value={`${fp(st.lc)} – ${fp(st.uc)}`} />}
        {st.fno && st.lot && <Row label="Futures lot" value={st.lot.toLocaleString("en-IN")} />}
      </Box>
      {q && <>
        <Typography component="h3" sx={{ mt: 2, mb: 0.5, fontSize: 12, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase" }}>
          Intraday checklist <Box component="span" sx={{ color: "text.secondary", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>· bull {q.bull} · bear {q.bear} of {q.avail}</Box>
        </Typography>
        {INDICATORS.map(([id, name, sub]) => {
          const check = q.checks[id];
          return <Box key={id} sx={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 1, py: 0.35, borderBottom: 1, borderColor: "divider", fontSize: 12.5 }}>
            <span>{name} <Box component="small" sx={{ color: "text.secondary" }}>{sub}</Box></span>
            <Box component="span" sx={{ color: !check ? "text.disabled" : check.side > 0 ? UP : check.side < 0 ? DOWN : "text.secondary", fontWeight: 700 }}>
              {!check ? "no data" : check.side > 0 ? "● bullish" : check.side < 0 ? "● bearish" : "○ neutral"}</Box>
            <Box component="span" sx={{ ...mono, textAlign: "right", color: "text.secondary" }}>{check?.text || "—"}</Box>
          </Box>;
        })}
        {q.side ? <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, mt: 1 }}>
          <Row label="Bias" value={`${q.side > 0 ? "Long" : "Short"} ${q.side > 0 ? q.bull : q.bear}/${q.avail}`} color={q.side > 0 ? UP : DOWN} />
          <Row label="Entry (now)" value={fp(st.ltp)} />
          <Row label="Stop-loss" value={fp(q.stop)} color={DOWN} />
          <Row label="Target 1:2" value={fp(q.target)} color={UP} />
        </Box> : <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Indicators are split — no intraday bias.</Typography>}
      </>}
      <Typography variant="body2" sx={{ mt: 2, p: 1.25, borderRadius: 2, bgcolor: "action.hover" }}>
        <b>What this means:</b> {build.read} {isNum(vwapGap) ? (vwapGap >= 0 ? "Price is above today's VWAP, so the average buyer today is in profit." : "Price is below today's VWAP, so the average buyer today is losing.") : ""}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Levels use classic floor pivots from the previous session plus today's range. Information only, not a recommendation.
      </Typography>
    </>;
  }
  return <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ role: "dialog", "aria-modal": true, "aria-label": st ? `${st.sym} stock card` : "Stock card", sx: { width: { xs: "100%", sm: 440 }, p: 2 } }}>
    {body}
  </Drawer>;
}
