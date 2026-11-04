import React from "react";
import { Box, Fade, Paper, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { BRAND_GRADIENT, glass, MONO } from "./theme";

/** A frosted panel. `hover` lifts it slightly on pointer hover (for clickable cards). */
export function GlassCard({ children, hover = false, padding = 2, sx, ...props }) {
  return <Paper sx={{
    p: padding, minWidth: 0,
    ...(hover && { cursor: "pointer", transition: "transform 200ms ease, box-shadow 200ms ease", "&:hover": { transform: "translateY(-2px)", boxShadow: glass.shadowHover } }),
    ...sx,
  }} {...props}>{children}</Paper>;
}

/** Page wrapper: consistent gutters, room for the phone's bottom bar, and a soft fade-in. */
export function PageShell({ children, className, maxWidth = 1480 }) {
  return <Fade in appear timeout={260}>
    <Box component="main" className={className} sx={{ px: { xs: 1.5, sm: 2.5 }, pt: 2.5, pb: { xs: 11, md: 4 }, maxWidth, mx: "auto", width: "100%", minWidth: 0 }}>
      {children}
    </Box>
  </Fade>;
}

export function PageHeader({ title, subtitle, actions }) {
  return <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "flex-end" }} justifyContent="space-between" sx={{ mb: 2 }}>
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="h1" component="h1">{title}</Typography>
      {subtitle && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography>}
    </Box>
    {actions && <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">{actions}</Stack>}
  </Stack>;
}

// The page's main switch: a tinted track and a brand-coloured selected pill.
const HIGHLIGHTED = {
  bgcolor: "rgba(74, 111, 224, 0.12)",
  "& .MuiToggleButton-root": { color: "accent.main", fontWeight: 800, px: 2.25, "&:hover": { bgcolor: "rgba(74, 111, 224, 0.12)" } },
  "& .MuiToggleButton-root.Mui-selected, & .MuiToggleButton-root.Mui-selected:hover": { background: BRAND_GRADIENT, color: "#fff", boxShadow: "0 4px 12px rgba(74, 111, 224, 0.35)" },
};

/** Pill switch. Keeps a value selected (clicking the active pill does nothing). */
export function Segmented({ value, onChange, options, label, size = "small", disabledValues = [], titles = {}, highlight = false }) {
  return <ToggleButtonGroup exclusive size={size} value={value} aria-label={label} sx={highlight ? HIGHLIGHTED : undefined}
    onChange={(_, next) => { if (next !== null && next !== undefined) onChange(next); }}>
    {options.map(([key, text]) => <ToggleButton key={key} value={key} aria-pressed={value === key}
      disabled={disabledValues.includes(key)} title={titles[key]}>{text}</ToggleButton>)}
  </ToggleButtonGroup>;
}

/** Small icon-only switch for secondary choices such as how a section is laid out. options: [[value, label, Icon]]. */
export function IconSwitch({ value, onChange, options, label }) {
  return <ToggleButtonGroup exclusive value={value} aria-label={label} onChange={(_, next) => { if (next !== null && next !== undefined) onChange(next); }}
    sx={{
      bgcolor: "transparent", p: 0, gap: 0.25,
      "& .MuiToggleButton-root": { width: 36, height: 36, p: 0, borderRadius: "10px !important", color: "text.secondary", "&:hover": { bgcolor: "action.hover" } },
      "& .MuiToggleButton-root.Mui-selected, & .MuiToggleButton-root.Mui-selected:hover": { bgcolor: "rgba(74, 111, 224, 0.14)", color: "accent.main", boxShadow: "none" },
    }}>
    {options.map(([key, text, Icon]) => <Tooltip key={key} title={`${text} view`}>
      <ToggleButton value={key} aria-label={text} aria-pressed={value === key}><Icon size={18} aria-hidden="true" /></ToggleButton>
    </Tooltip>)}
  </ToggleButtonGroup>;
}

export function SectionTitle({ children, actions, sx }) {
  return <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.25, ...sx }}>
    <Typography variant="overline" component="h2" color="text.secondary">{children}</Typography>
    {actions}
  </Stack>;
}

/** Numbers in the mono face so columns of prices line up. */
export const mono = { fontFamily: MONO, fontVariantNumeric: "tabular-nums" };
export const upDown = value => (Number(value) > 0 ? "success.main" : Number(value) < 0 ? "error.main" : "text.primary");
