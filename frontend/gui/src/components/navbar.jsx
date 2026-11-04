import React from "react";
import { AppBar, Box, IconButton, Toolbar, Tooltip } from "@mui/material";
import { Activity, ChartNoAxesColumn, ChartScatter, House, Layers, Moon, RefreshCw, Settings, Sun, WalletCards } from "lucide-react";
import logo from "../assets/brand/utraders-logo-dark.png";
import logoOnDark from "../assets/brand/utraders-logo-light.png";
import brandMark from "../assets/brand/utraders-mark.png";
import { useTheme } from "../theme";

export const NAV_ITEMS = [
  ["dashboard", "Home", "Home", House],
  ["index-stocks", "Index Stocks", "Stocks", ChartScatter],
  ["equity", "Equity", "Equity", ChartNoAxesColumn],
  ["index-options", "Index Options", "Options", Layers],
  ["oi-analysis", "OI Analysis", "OI", Activity],
  ["trading", "My Trading", "Trading", WalletCards],
  ["settings", "Settings", "Settings", Settings],
];
// Pages that poll their own data; the dashboard refresh button only applies to Home's market tables.
export const OWN_REFRESH = ["index-stocks", "equity", "index-options", "oi-analysis", "trading", "settings"];

// Three uneven lines that even out on hover.
export function BurgerIcon() {
  return <Box aria-hidden="true" sx={{
    display: "grid", gap: "4px", width: 18, justifyItems: "start",
    "& span": { display: "block", height: 2, borderRadius: 2, bgcolor: "currentColor", transition: "width 200ms ease" },
    "& span:nth-of-type(1)": { width: "100%" }, "& span:nth-of-type(2)": { width: "60%" }, "& span:nth-of-type(3)": { width: "80%" },
    "button:hover & span": { width: "100%" },
  }}><span /><span /><span /></Box>;
}

// Phones and small tablets only; from 900px wide the sidebar holds all of this.
export default function Navbar({ changePage = () => {}, currentPage, handleDashboardRefresh, onMenu = () => {}, menuOpen = false }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  const themeLabel = dark ? "Switch to light mode" : "Switch to dark mode";
  return <AppBar position="sticky" sx={{ top: 0, zIndex: theme => theme.zIndex.appBar, display: { xs: "flex", md: "none" } }}>
    <Toolbar sx={{ gap: 1, minHeight: { xs: 60 }, px: { xs: 1, sm: 2 } }}>
      <Tooltip title="Menu">
        <IconButton aria-label="Open menu" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={onMenu} sx={{ width: 40, height: 40, borderRadius: 3 }}><BurgerIcon /></IconButton>
      </Tooltip>
      <Box component="button" type="button" onClick={() => changePage("dashboard")} aria-label="Utraders dashboard"
        sx={{ display: "flex", alignItems: "center", border: 0, background: "none", p: 0.5, cursor: "pointer", borderRadius: 2, flex: "none" }}>
        <Box component="img" src={dark ? logoOnDark : logo} alt="" sx={{ height: 38, display: { xs: "none", sm: "block" } }} />
        <Box component="img" src={brandMark} alt="" sx={{ height: 34, display: { xs: "block", sm: "none" } }} />
      </Box>
      <Box sx={{ flex: 1 }} />
      {!OWN_REFRESH.includes(currentPage) && handleDashboardRefresh && <Tooltip title="Refresh market data">
        <IconButton aria-label="Refresh market data" onClick={handleDashboardRefresh}><RefreshCw size={20} /></IconButton>
      </Tooltip>}
      <Tooltip title={themeLabel}>
        <IconButton aria-label={themeLabel} onClick={toggleTheme}>{dark ? <Sun size={20} /> : <Moon size={20} />}</IconButton>
      </Tooltip>
    </Toolbar>
  </AppBar>;
}
