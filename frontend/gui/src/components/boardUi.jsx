import React, { useState } from "react";
import { Box, Chip, MenuItem, Paper, TextField, Typography } from "@mui/material";
import { CAPS, SEGMENTS, fpc } from "../boardData";
import { mono } from "../ui/Glass";

export const UP = "success.main";
export const DOWN = "error.main";
export const toneColor = value => Number.isFinite(value) && value !== 0 ? (value > 0 ? UP : DOWN) : "text.secondary";
const FILTER_KEY = "utraders-board-filter";

const readFilter = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY)) || {};
    return { segment: SEGMENTS.some(([key]) => key === saved.segment) ? saved.segment : "all",
      cap: CAPS.some(([key]) => key === saved.cap) ? saved.cap : "all" };
  } catch { return { segment: "all", cap: "all" }; }
};

/** Segment and cap filters shared by the Money Flow and Intraday pages, remembered in this browser. */
export function useBoardFilters() {
  const [filter, setFilter] = useState(readFilter);
  const update = change => setFilter(previous => {
    const next = { ...previous, ...change };
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  return [filter, update];
}

export function StatusChip({ snapshot, error }) {
  const status = error ? "offline" : snapshot?.status || "waiting";
  const label = { live: "LIVE", closed: snapshot?.session ? `CLOSED · ${new Date(`${snapshot.session}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}` : "CLOSED",
    stale: "PAUSED", waiting: "WAITING", offline: "OFFLINE" }[status] || status.toUpperCase();
  const color = status === "live" ? "success" : status === "closed" ? "default" : "warning";
  return <Chip size="small" color={color} variant={status === "live" ? "filled" : "outlined"} label={label}
    sx={{ fontWeight: 800, letterSpacing: 0.5, height: 22 }} />;
}

export function BoardMessage({ snapshot, error }) {
  const text = error || snapshot?.message;
  if (!text) return null;
  return <Typography role="status" variant="body2" sx={{ mb: 1.5, px: 1.5, py: 1, borderRadius: 2, bgcolor: "action.hover", color: "text.secondary" }}>{text}</Typography>;
}

export function FilterBar({ filter, onChange, shown, total }) {
  return <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", mb: 1.5 }}>
    <TextField select size="small" label="Stocks" value={filter.segment} onChange={event => onChange({ segment: event.target.value })}
      SelectProps={{ inputProps: { "aria-label": "Stocks" } }} sx={{ minWidth: 210 }}>
      {SEGMENTS.map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
    </TextField>
    <TextField select size="small" label="Market cap" value={filter.cap} onChange={event => onChange({ cap: event.target.value })}
      SelectProps={{ inputProps: { "aria-label": "Market cap" } }} sx={{ minWidth: 140 }}>
      {CAPS.map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
    </TextField>
    {Number.isFinite(shown) && <Typography variant="caption" color="text.secondary">{shown} of {total} names</Typography>}
  </Box>;
}

/** A card with the file's small upper-case heading and a muted note on the right. */
export function Panel({ title, note, actions, children, sx, titleColor, ...props }) {
  return <Paper component="section" aria-label={typeof title === "string" ? title : undefined} {...props}
    sx={{ p: 1.5, minWidth: 0, ...sx }}>
    {(title || note || actions) && <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1, mb: 1 }}>
      <Typography component="h2" sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: titleColor || "text.primary" }}>{title}</Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        {note && <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{note}</Typography>}
        {actions}
      </Box>
    </Box>}
    {children}
  </Paper>;
}

const TAG_COLORS = { LB: "success", SC: "success", UP: "success", SB: "error", LU: "error", DN: "error" };
export function BuildTag({ code }) {
  if (!code) return null;
  return <Box component="span" title={code} sx={{ display: "inline-block", px: 0.6, borderRadius: 1, fontSize: 10.5, fontWeight: 800, lineHeight: "17px",
    color: `${TAG_COLORS[code] || "info"}.main`, bgcolor: theme => `${theme.palette[TAG_COLORS[code] || "info"].main}1f` }}>{code}</Box>;
}

export function SegBadges({ st }) {
  const badge = (text, title, color) => <Box component="span" title={title} sx={{ ml: 0.5, px: 0.4, borderRadius: 0.75, fontSize: 9, fontWeight: 800,
    border: 1, borderColor: "divider", color, lineHeight: "14px", verticalAlign: "middle" }}>{text}</Box>;
  return <>{st.fno ? badge("F&O", "F&O stock", "info.main") : badge("CASH", "Cash-only stock", "text.secondary")}
    {st.sx ? badge("SX", "Sensex 30 stock", "warning.main") : st.n50 ? badge("N50", "Nifty 50 stock", "warning.main") : null}</>;
}

export function Pct({ value, sx }) {
  return <Box component="span" sx={{ ...mono, color: toneColor(value), ...sx }}>{fpc(value)}</Box>;
}

/** A stock name that opens its card. */
export function NameButton({ st, onPick, badges = false, sx }) {
  return <Box component="button" type="button" onClick={() => onPick(st.sym)} title={`${st.company || st.sym} · open stock card`}
    sx={{ all: "unset", cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
      "&:hover, &:focus-visible": { textDecoration: "underline" }, ...sx }}>
    {st.sym}{badges && <SegBadges st={st} />}
  </Box>;
}

export function Dots({ checks, ids }) {
  return <Box component="span" sx={{ display: "inline-flex", gap: "3px", alignItems: "center" }}>
    {ids.map(([id, name]) => {
      const check = checks[id];
      const color = !check ? "transparent" : check.side > 0 ? UP : check.side < 0 ? DOWN : "text.disabled";
      return <Box key={id} component="i" title={`${name}: ${check ? check.text : "no data"}`}
        sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, border: check ? 0 : "1px dashed", borderColor: "text.disabled" }} />;
    })}
  </Box>;
}
