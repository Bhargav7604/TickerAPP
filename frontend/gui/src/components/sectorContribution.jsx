import React, { useEffect, useRef, useState } from "react";
import { Box, ButtonBase, Chip, Collapse, Paper, Stack, Typography } from "@mui/material";
import { mono } from "../ui/Glass";

const LIVE_MS = 5000;
const CLOSED_MS = 60000;
const points = value => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(1)}` : "--";
const pointsColor = value => value > 0 ? "success.main" : value < 0 ? "error.main" : "text.secondary";
const clock = seconds => new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" });

function SectorRow({ sector, scale, open, onToggle }) {
  const color = pointsColor(sector.points);
  return <Box component="li">
    <ButtonBase onClick={onToggle} aria-expanded={open} aria-label={`${sector.name} ${points(sector.points)} points`} sx={{
      width: "100%", display: "grid", gridTemplateColumns: "minmax(0, 150px) minmax(0, 1fr) 52px", alignItems: "center", gap: 1.25,
      px: 1, py: 0.7, borderRadius: 2, textAlign: "left", "&:hover": { bgcolor: "action.hover" },
      "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main" },
    }}>
      <Typography component="span" sx={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sector.name}</Typography>
      <Box component="span" aria-hidden="true" sx={{ height: 10, borderRadius: 999, bgcolor: "background.subtle", overflow: "hidden" }}>
        <Box component="span" sx={{ display: "block", height: "100%", borderRadius: 999, bgcolor: color, transition: "width 400ms ease",
          width: `${Math.max(3, Math.abs(sector.points) / scale * 100)}%` }} />
      </Box>
      <Typography component="span" sx={{ ...mono, fontSize: 13, fontWeight: 800, textAlign: "right", color }}>{points(sector.points)}</Typography>
    </ButtonBase>
    <Collapse in={open} unmountOnExit>
      <Stack direction="row" useFlexGap flexWrap="wrap" gap={0.75} sx={{ px: 1, pt: 0.25, pb: 1 }}>
        {sector.stocks.map(stock => <Chip key={stock.symbol} size="small" variant="outlined" label={`${stock.symbol} ${points(stock.points)}`}
          sx={{ ...mono, fontWeight: 700, color: pointsColor(stock.points) }} />)}
      </Stack>
    </Collapse>
  </Box>;
}

function SectorColumn({ title, sectors, scale, open, onToggle, color }) {
  return <Box sx={{ minWidth: 0 }}>
    <Typography variant="overline" component="h3" sx={{ px: 1, color }}>{title}</Typography>
    {sectors.length
      ? <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
        {sectors.map(sector => <SectorRow key={sector.name} sector={sector} scale={scale} open={open === sector.name} onToggle={() => onToggle(sector.name)} />)}
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
        <SectorColumn title={`Pushing ${shortLabel} up`} sectors={rising} scale={scale} open={open} onToggle={toggle} color="success.main" />
        <SectorColumn title={`Pulling ${shortLabel} down`} sectors={falling} scale={scale} open={open} onToggle={toggle} color="error.main" />
      </Box>
      {flat.length > 0 && <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, px: 1 }}>No change: {flat.map(sector => sector.name).join(", ")}</Typography>}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.25, px: 1 }}>
        Tap a sector to see its stocks. Sectors add up to {points(data.explained)} of {shortLabel}'s {points(data.indexMove)} points
        {data.weightsOn ? ` · weights from ${new Date(data.weightsOn + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : ""}.
      </Typography>
    </>}
  </Paper>;
}
