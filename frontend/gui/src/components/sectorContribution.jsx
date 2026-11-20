import React, { useEffect, useRef, useState } from "react";
import { Box, ButtonBase, Chip, Collapse, Paper, Stack, Typography } from "@mui/material";
import { mono } from "../ui/Glass";

const LIVE_MS = 5000;
const CLOSED_MS = 60000;
const points = value => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(1)}` : "--";
const pointsColor = value => value > 0 ? "success.main" : value < 0 ? "error.main" : "text.secondary";
const price = value => Number.isFinite(value) ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--";
const signed = value => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${price(value)}` : "--";
const signedPct = value => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "--";
const STOCK_COLUMNS = "minmax(96px, 1.1fr) 84px minmax(132px, 1.4fr) 64px 92px";
const clock = seconds => new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" });
const istDay = date => date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
/** " · weights updated 12:45" when refitted today, otherwise the day they were fitted. */
export function weightsNote(data, now = new Date()) {
  const at = data?.weightsAt ? new Date(data.weightsAt) : null;
  if (at && !Number.isNaN(at.getTime()) && istDay(at) === istDay(now)) {
    return ` · weights updated ${at.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}`;
  }
  return data?.weightsOn ? ` · weights from ${new Date(data.weightsOn + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : "";
}

/** A stock's NIFTY points next to its own price move, so points are never read as rupees. */
function StockTable({ sector, indexLabel }) {
  const lead = sector.stocks.find(stock => Number.isFinite(stock.change) && Number.isFinite(stock.weightPct));
  return <Box sx={{ px: 1, pt: 0.25, pb: 1 }}>
    <Box role="table" aria-label={`${sector.name} stocks`} sx={{ overflowX: "auto" }}>
      <Box role="row" sx={{ display: "grid", gridTemplateColumns: STOCK_COLUMNS, gap: 1, minWidth: 500, py: 0.5, fontSize: 11, fontWeight: 700, color: "text.secondary" }}>
        <span role="columnheader">Stock</span>
        <Box component="span" role="columnheader" sx={{ textAlign: "right" }}>Price ₹</Box>
        <Box component="span" role="columnheader" sx={{ textAlign: "right" }}>Change ₹ (%)</Box>
        <Box component="span" role="columnheader" sx={{ textAlign: "right" }} title={`Share of ${indexLabel} at yesterday's close`}>Weight</Box>
        <Box component="span" role="columnheader" sx={{ textAlign: "right" }}>{indexLabel} pts</Box>
      </Box>
      {sector.stocks.map(stock => <Box key={stock.symbol} role="row" sx={{ display: "grid", gridTemplateColumns: STOCK_COLUMNS, gap: 1, minWidth: 500, py: 0.45,
        borderTop: 1, borderColor: "divider", fontSize: 12.5, alignItems: "center" }}>
        <Box component="span" role="cell" sx={{ fontWeight: 800 }}>{stock.symbol}</Box>
        <Box component="span" role="cell" sx={{ ...mono, textAlign: "right" }}>{price(stock.ltp)}</Box>
        <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", color: pointsColor(stock.change ?? stock.changePct) }}>
          {Number.isFinite(stock.change) ? `${signed(stock.change)} (${signedPct(stock.changePct)})` : signedPct(stock.changePct)}
        </Box>
        <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", color: "text.secondary" }}>{Number.isFinite(stock.weightPct) ? `${stock.weightPct.toFixed(1)}%` : "--"}</Box>
        <Box component="span" role="cell" sx={{ ...mono, textAlign: "right", fontWeight: 800, color: pointsColor(stock.points) }}>{points(stock.points)} pts</Box>
      </Box>)}
    </Box>
    {lead && <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75 }}>
      {indexLabel} pts are index points, not the stock's price: {lead.symbol} moved {lead.change >= 0 ? "+" : "−"}₹{price(Math.abs(lead.change))} ({signedPct(lead.changePct)}) and is {lead.weightPct.toFixed(1)}% of {indexLabel}, so it moved {indexLabel} by {points(lead.points)} points.
    </Typography>}
  </Box>;
}

function SectorRow({ sector, scale, open, onToggle, indexLabel }) {
  const color = pointsColor(sector.points);
  return <Box component="li">
    <ButtonBase onClick={onToggle} aria-expanded={open} aria-label={`${sector.name} ${points(sector.points)} ${indexLabel} points`} sx={{
      width: "100%", display: "grid", gridTemplateColumns: "minmax(0, 150px) minmax(0, 1fr) 76px", alignItems: "center", gap: 1.25,
      px: 1, py: 0.7, borderRadius: 2, textAlign: "left", "&:hover": { bgcolor: "action.hover" },
      "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main" },
    }}>
      <Typography component="span" sx={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sector.name}</Typography>
      <Box component="span" aria-hidden="true" sx={{ height: 10, borderRadius: 999, bgcolor: "background.subtle", overflow: "hidden" }}>
        <Box component="span" sx={{ display: "block", height: "100%", borderRadius: 999, bgcolor: color, transition: "width 400ms ease",
          width: `${Math.max(3, Math.abs(sector.points) / scale * 100)}%` }} />
      </Box>
      <Typography component="span" sx={{ ...mono, fontSize: 13, fontWeight: 800, textAlign: "right", color }}>
        {points(sector.points)}<Box component="small" sx={{ ml: 0.4, fontSize: 10.5, fontWeight: 700, color: "text.secondary" }}>pts</Box>
      </Typography>
    </ButtonBase>
    <Collapse in={open} unmountOnExit><StockTable sector={sector} indexLabel={indexLabel} /></Collapse>
  </Box>;
}

function SectorColumn({ title, sectors, scale, open, onToggle, color, indexLabel }) {
  return <Box sx={{ minWidth: 0 }}>
    <Typography variant="overline" component="h3" sx={{ px: 1, color }}>{title}</Typography>
    {sectors.length
      ? <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
        {sectors.map(sector => <SectorRow key={sector.name} sector={sector} scale={scale} open={open === sector.name} onToggle={() => onToggle(sector.name)} indexLabel={indexLabel} />)}
      </Box>
      : <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>None right now.</Typography>}
  </Box>;
}

/** Index points each sector added or took away since yesterday's close. */
export default function SectorContribution({ load, index = "nifty", sx }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const delay = useRef(LIVE_MS);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    const abort = new AbortController();
    let first = true;
    const run = async () => {
      if (first || document.visibilityState !== "hidden") {
        first = false;
        try {
          const next = await load(index, abort.signal);
          if (stopped) return;
          setData(next);
          setError("");
          delay.current = next.retryAfterMs ? Math.max(1000, next.retryAfterMs) : next.marketOpen ? LIVE_MS : CLOSED_MS;
        } catch (exc) {
          if (stopped) return;
          setError(exc.message);
          delay.current = LIVE_MS * 2;
        }
      }
      if (!stopped) timer = setTimeout(run, delay.current);
    };
    run();
    return () => { stopped = true; abort.abort(); clearTimeout(timer); };
  }, [load, index]);

  const sectors = data?.sectors || [];
  const scale = Math.max(1, ...sectors.map(sector => Math.abs(sector.points)));
  const rising = sectors.filter(sector => sector.points > 0);
  const falling = sectors.filter(sector => sector.points < 0).reverse();
  const flat = sectors.filter(sector => sector.points === 0);
  const toggle = name => setOpen(current => current === name ? null : name);
  const shortLabel = (data?.label || "NIFTY 50").replace(" 50", "");

  return <Paper component="section" aria-label="Sector contribution" sx={{ gridArea: "sectors", minWidth: 0, p: 2, ...sx }}>
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} justifyContent="space-between" alignItems={{ sm: "flex-start" }} sx={{ mb: 1 }}>
      <Box>
        <Typography variant="overline" component="h2" color="text.secondary">Sector contribution · {shortLabel}</Typography>
        <Typography variant="body2" color="text.secondary">Index points each sector added or took away since yesterday's close</Typography>
      </Box>
      {data && Number.isFinite(data.indexMove) && <Stack direction="row" spacing={1} alignItems="center">
        <Chip label={`${shortLabel} ${points(data.indexMove)} pts`} sx={{ ...mono, fontWeight: 800, color: pointsColor(data.indexMove),
          bgcolor: data.indexMove >= 0 ? "rgba(14,159,110,0.12)" : "rgba(224,68,90,0.12)" }} />
        <Typography variant="caption" color="text.secondary">{data.marketOpen ? "Live" : "Market closed"}{data.asOf ? ` · ${clock(data.asOf)}` : ""}</Typography>
      </Stack>}
    </Stack>

    {error && <Typography variant="body2" color="error.main" role="alert">{error}</Typography>}
    {!data && !error && <Typography variant="body2" color="text.secondary" role="status">Loading sector contribution…</Typography>}
    {data?.message && <Typography variant="body2" color="text.secondary" role="status">{data.message}</Typography>}

    {sectors.length > 0 && <>
      <Box sx={{ display: "grid", gap: { xs: 1.5, md: 3 }, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" } }}>
        <SectorColumn title={`Pushing ${shortLabel} up`} sectors={rising} scale={scale} open={open} onToggle={toggle} color="success.main" indexLabel={shortLabel} />
        <SectorColumn title={`Pulling ${shortLabel} down`} sectors={falling} scale={scale} open={open} onToggle={toggle} color="error.main" indexLabel={shortLabel} />
      </Box>
      {flat.length > 0 && <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, px: 1 }}>No change: {flat.map(sector => sector.name).join(", ")}</Typography>}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.25, px: 1 }}>
        Tap a sector to see its stocks. Sectors add up to {points(data.explained)} of {shortLabel}'s {points(data.indexMove)} points
        {weightsNote(data)}.
      </Typography>
    </>}
  </Paper>;
}
