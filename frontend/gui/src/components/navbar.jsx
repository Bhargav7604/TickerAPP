import React, { useState } from "react";
import { AppBar, Box, Button, Divider, IconButton, ListItemIcon, Menu, MenuItem, Toolbar, Tooltip, Typography } from "@mui/material";
import { Activity, ChartNoAxesColumn, ChartScatter, House, Layers, LogOut, Moon, RefreshCw, Settings, Sun, UserCircle, WalletCards } from "lucide-react";
import logo from "../assets/brand/utraders-logo-dark.png";
import logoOnDark from "../assets/brand/utraders-logo-light.png";
import { useTheme } from "../theme";
import brandMark from "../assets/brand/utraders-mark.png";

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
const OWN_REFRESH = ["index-stocks", "equity", "index-options", "oi-analysis", "trading", "settings"];

export default function Navbar({ username, handleLogout, changePage = () => {}, currentPage, handleDashboardRefresh }) {
  const [anchor, setAnchor] = useState(null);
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  const themeLabel = dark ? "Switch to light mode" : "Switch to dark mode";
  return <AppBar position="sticky" sx={{ top: 0, zIndex: theme => theme.zIndex.appBar }}>
    <Toolbar component="nav" aria-label="Main navigation" sx={{ gap: 1.5, minHeight: { xs: 60 }, px: { xs: 1.5, sm: 2.5 } }}>
      <Box component="button" type="button" onClick={() => changePage("dashboard")} aria-label="Utraders dashboard"
        sx={{ display: "flex", alignItems: "center", border: 0, background: "none", p: 0.5, cursor: "pointer", borderRadius: 2, flex: "none" }}>
        <Box component="img" src={dark ? logoOnDark : logo} alt="" sx={{ height: 38, display: { xs: "none", sm: "block" } }} />
        <Box component="img" src={brandMark} alt="" sx={{ height: 34, display: { xs: "block", sm: "none" } }} />
      </Box>

      <Box sx={{ display: { xs: "none", lg: "flex" }, gap: 0.5, flex: 1, justifyContent: "center", minWidth: 0 }}>
        {NAV_ITEMS.map(([page, label, , Icon]) => {
          const active = currentPage === page;
          return <Button key={page} onClick={() => changePage(page)} aria-current={active ? "page" : undefined}
            startIcon={<Icon size={17} />} size="small"
            sx={{
              px: 1.75, height: 38, color: active ? "accent.main" : "text.secondary", bgcolor: active ? "rgba(74, 111, 224, 0.14)" : "transparent",
              "&:hover": { bgcolor: active ? "rgba(74, 111, 224, 0.20)" : "action.hover" },
            }}>{label}</Button>;
        })}
      </Box>
      <Box sx={{ flex: { xs: 1, lg: "none" } }} />

      {!OWN_REFRESH.includes(currentPage) && handleDashboardRefresh && <Tooltip title="Refresh market data">
        <IconButton aria-label="Refresh market data" onClick={handleDashboardRefresh}><RefreshCw size={20} /></IconButton>
      </Tooltip>}
      <Tooltip title={themeLabel}>
        <IconButton aria-label={themeLabel} onClick={toggleTheme}>{dark ? <Sun size={20} /> : <Moon size={20} />}</IconButton>
      </Tooltip>
      <Tooltip title="Account">
        <IconButton aria-label="Account menu" aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={event => setAnchor(event.currentTarget)}>
          <UserCircle size={24} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">Signed in as</Typography>
          <Typography variant="subtitle1">{username}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={() => { setAnchor(null); changePage("settings"); }}>
          <ListItemIcon><Settings size={17} /></ListItemIcon>Settings
        </MenuItem>
        <MenuItem onClick={() => { setAnchor(null); if (handleLogout) handleLogout(); }}>
          <ListItemIcon><LogOut size={17} /></ListItemIcon>Log out
        </MenuItem>
      </Menu>
    </Toolbar>
  </AppBar>;
}
