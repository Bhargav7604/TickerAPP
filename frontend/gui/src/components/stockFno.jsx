import React, { useState } from "react";
import { Box, Typography } from "@mui/material";
import { useBoard } from "../boardData";
import { BoardMessage, BuildTag, NameButton, Panel, Pct, StatusChip, UP, DOWN } from "./boardUi";
import StockDrawer from "./stockDrawer";
import { mono } from "../ui/Glass";

const QUADRANTS = [
  ["LB", "Long build-up", "price ▲ OI ▲ · fresh buying", UP],
  ["SC", "Short covering", "price ▲ OI ▼ · shorts exiting", UP],
  ["SB", "Short build-up", "price ▼ OI ▲ · fresh selling", DOWN],
  ["LU", "Long unwinding", "price ▼ OI ▼ · longs exiting", DOWN],
];
const dateLabel = iso => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });

/** Stock futures sorted into the four build-up boxes, and the index expiry calendar. */
export default function StockFno({ api }) {
  const { snapshot, error, loading } = useBoard(api);
  const [pick, setPick] = useState(null);
  const futures = (snapshot?.stocks || []).filter(st => Number.isFinite(st.oc));
  return <Box>
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
      <StatusChip snapshot={snapshot} error={error} />
      <Typography variant="body2" color="text.secondary">
        {futures.length ? `${futures.length} stock futures · OI change against the previous close` : loading ? "Loading stock futures…" : "Stock futures appear once market data is connected."}
      </Typography>
    </Box>
    <BoardMessage snapshot={snapshot} error={error} />
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(2, minmax(0, 1fr))", lg: "repeat(4, minmax(0, 1fr))" }, gap: 1.5, mb: 1.5 }}>
      {QUADRANTS.map(([code, title, sub, color]) => {
        const list = futures.filter(st => st.b === code).sort((a, b) => Math.abs(b.oc) - Math.abs(a.oc));
        return <Panel key={code} aria-label={title} sx={{ borderTop: 3, borderColor: color }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <BuildTag code={code} />
            <Typography component="h2" sx={{ fontWeight: 800, flex: 1 }}>{title}</Typography>
            <Typography sx={{ ...mono, fontWeight: 850, fontSize: 18 }}>{list.length}</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.75 }}>{sub}</Typography>
          {list.slice(0, 6).map(st => <Box key={st.sym} sx={{ display: "grid", gridTemplateColumns: "1fr 64px 76px", gap: 1, py: 0.35, borderTop: 1, borderColor: "divider", fontSize: 12.5 }}>
            <NameButton st={st} onPick={setPick} />
            <Box component="span" sx={{ textAlign: "right" }}><Pct value={st.pc} /></Box>
            <Box component="span" sx={{ ...mono, textAlign: "right", color: "text.secondary" }}>OI {st.oc >= 0 ? "+" : ""}{st.oc.toFixed(1)}%</Box>
          </Box>)}
          {!list.length && <Typography variant="body2" color="text.secondary">None right now.</Typography>}
        </Panel>;
      })}
    </Box>
    <Panel title="Expiry & lot sizes" note="from Zerodha's contract list">
      <Box role="table" aria-label="Index expiries and lot sizes" sx={{ overflowX: "auto" }}>
        <Box role="row" sx={{ display: "grid", gridTemplateColumns: "110px 80px minmax(180px, 1fr) 56px 56px", gap: 1, fontSize: 11, fontWeight: 700, color: "text.secondary", minWidth: 500 }}>
          <span role="columnheader">Index</span><span role="columnheader">Cycle</span><span role="columnheader">Next expiries</span>
          <Box component="span" role="columnheader" sx={{ textAlign: "right" }}>In</Box><Box component="span" role="columnheader" sx={{ textAlign: "right" }}>Lot</Box>
        </Box>
        {(snapshot?.calendar || []).map(row => <Box key={row.index} role="row" sx={{ display: "grid", gridTemplateColumns: "110px 80px minmax(180px, 1fr) 56px 56px", gap: 1, py: 0.5, borderTop: 1, borderColor: "divider", fontSize: 12.5, minWidth: 500 }}>
          <Box component="b" role="cell">{row.index}</Box><span role="cell">{row.cycle}</span>
          <span role="cell">{row.next.slice(0, 3).map(dateLabel).join(" · ")}</span>
          <Box component="span" role="cell" sx={{ ...mono, textAlign: "right" }}>{row.daysTo}d</Box>
          <Box component="span" role="cell" sx={{ ...mono, textAlign: "right" }}>{row.lot}</Box>
        </Box>)}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
        Expiries move to the previous trading day when they fall on a holiday. The F&O ban list is not available from Zerodha.
      </Typography>
    </Panel>
    <StockDrawer sym={pick} snapshot={snapshot} api={api} onClose={() => setPick(null)} />
  </Box>;
}
