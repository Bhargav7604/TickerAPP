import React, { useEffect, useRef, useState } from "react";
import { Box, ButtonBase, ClickAwayListener, Divider, Drawer, IconButton, InputBase, ListItemIcon, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import { ChevronRight, LogOut, Moon, RefreshCw, Search, Settings, Sun, X } from "lucide-react";
import logo from "../assets/brand/utraders-logo-dark.png";
import logoOnDark from "../assets/brand/utraders-logo-light.png";
import brandMark from "../assets/brand/utraders-mark.png";
import { useTheme } from "../theme";
import { BurgerIcon, NAV_ITEMS, OWN_REFRESH } from "./navbar";

export const RAIL_WIDTH = 72;
const OPEN_WIDTH = 252;
const ACTIVE_TINT = "rgba(74, 111, 224, 0.13)";

function Row({ icon: Icon, label, expanded, active = false, onClick }) {
  const row = <ButtonBase aria-label={label} aria-current={active ? "page" : undefined} onClick={onClick} sx={{
    position: "relative", flex: "none", width: "100%", height: 46, display: "flex", alignItems: "center", justifyContent: expanded ? "flex-start" : "center",
    gap: 2, px: expanded ? 3 : 0, color: active ? "accent.main" : "text.secondary", bgcolor: active ? ACTIVE_TINT : "transparent",
    transition: "background-color 160ms ease, color 160ms ease",
    "&:hover": { bgcolor: active ? ACTIVE_TINT : "action.hover", color: active ? "accent.main" : "text.primary" },
    "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
  }}>
    {active && <Box aria-hidden="true" sx={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, bgcolor: "primary.main" }} />}
    <Icon size={20} aria-hidden="true" />
    {expanded && <Typography component="span" sx={{ fontSize: 14, fontWeight: active ? 700 : 600, whiteSpace: "nowrap" }}>{label}</Typography>}
  </ButtonBase>;
  return expanded ? row : <Tooltip title={label} placement="right">{row}</Tooltip>;
}

function SidebarContent({ expanded, onToggle, toggleLabel, toggleIcon, onExpand, onOpen, currentPage, username, handleLogout, handleDashboardRefresh }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState(null);
  const inputRef = useRef(null);
  const focusSearch = useRef(false);

  useEffect(() => {
    if (!expanded) { setQuery(""); return; }
    if (focusSearch.current) { focusSearch.current = false; inputRef.current?.focus(); }
  }, [expanded]);

  const words = query.trim().toLowerCase();
  const matches = NAV_ITEMS.filter(([, label]) => label.toLowerCase().includes(words));
  const pages = matches.filter(([page]) => page !== "settings");
  const settings = matches.find(([page]) => page === "settings");
  const row = ([page, label, , Icon]) => <Row key={page} icon={Icon} label={label} expanded={expanded} active={currentPage === page} onClick={() => onOpen(page)} />;
  const account = action => { setAnchor(null); action(); };

  return <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
    <Box sx={{ flex: "none", display: "flex", flexDirection: expanded ? "row" : "column", alignItems: "center", justifyContent: expanded ? "space-between" : "center", gap: 1, pt: 1.5, pb: 1, px: expanded ? 2.25 : 0 }}>
      <ButtonBase aria-label="Utraders dashboard" onClick={() => onOpen("dashboard")} sx={{ borderRadius: 2, flex: "none" }}>
        <Box component="img" src={expanded ? (dark ? logoOnDark : logo) : brandMark} alt="" sx={{ height: expanded ? 38 : 34, display: "block" }} />
      </ButtonBase>
      <Tooltip title={toggleLabel} placement="right">
        <IconButton aria-label={toggleLabel} aria-expanded={expanded} onClick={onToggle} sx={{ width: 40, height: 40, borderRadius: 3, color: "text.secondary" }}>{toggleIcon}</IconButton>
      </Tooltip>
    </Box>

    <Box sx={{ flex: "none", px: expanded ? 2.25 : 0, pb: 1.25, display: "flex", justifyContent: "center" }}>
      {expanded
        ? <Box sx={{ width: "100%", height: 40, px: 1.5, display: "flex", alignItems: "center", gap: 1, borderRadius: 3, bgcolor: "background.subtle", color: "text.secondary" }}>
          <Search size={17} aria-hidden="true" />
          <InputBase inputRef={inputRef} placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} inputProps={{ "aria-label": "Search pages" }} sx={{ flex: 1, fontSize: 14 }}
            onKeyDown={event => { if (event.key === "Enter" && matches[0]) onOpen(matches[0][0]); }} />
        </Box>
        : <Tooltip title="Search pages" placement="right">
          <IconButton aria-label="Search pages" onClick={() => { focusSearch.current = true; onExpand(); }} sx={{ width: 40, height: 40, borderRadius: 3, bgcolor: "background.subtle", color: "text.secondary" }}><Search size={18} /></IconButton>
        </Tooltip>}
    </Box>

    <Box component="nav" aria-label="Main navigation" sx={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      {pages.map(row)}
      {settings && pages.length > 0 && <Divider sx={{ flex: "none", my: 1, mx: expanded ? 2.25 : 2 }} />}
      {settings && row(settings)}
      {!matches.length && <Typography sx={{ px: 3, py: 1, fontSize: 13, color: "text.secondary" }}>No page found</Typography>}
    </Box>

    <Box sx={{ flex: "none", pt: 0.5 }}>
      {!OWN_REFRESH.includes(currentPage) && handleDashboardRefresh && <Row icon={RefreshCw} label="Refresh market data" expanded={expanded} onClick={handleDashboardRefresh} />}
      <Row icon={dark ? Sun : Moon} label={dark ? "Switch to light mode" : "Switch to dark mode"} expanded={expanded} onClick={toggleTheme} />
      <ButtonBase aria-label="Account menu" aria-haspopup="menu" aria-expanded={Boolean(anchor)} onClick={event => setAnchor(event.currentTarget)} sx={{
        width: "100%", height: 64, display: "flex", alignItems: "center", justifyContent: expanded ? "flex-start" : "center", gap: 1.5, px: expanded ? 2.25 : 0,
        "&:hover": { bgcolor: "action.hover" }, "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
      }}>
        <Box aria-hidden="true" sx={{ flex: "none", width: 38, height: 38, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "text.primary", color: "background.paper", fontWeight: 800, fontSize: 15 }}>
          {(username || "U")[0].toUpperCase()}
        </Box>
        {expanded && <>
          <Typography component="span" sx={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{username}</Typography>
          <ChevronRight size={17} aria-hidden="true" />
        </>}
      </ButtonBase>
    </Box>

    <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
      anchorOrigin={{ vertical: "top", horizontal: "right" }} transformOrigin={{ vertical: "bottom", horizontal: "left" }}>
      <Box sx={{ px: 2, py: 1 }}>
        <Typography variant="caption" color="text.secondary">Signed in as</Typography>
        <Typography variant="subtitle1">{username}</Typography>
      </Box>
      <Divider />
      <MenuItem onClick={() => account(() => onOpen("settings"))}><ListItemIcon><Settings size={17} /></ListItemIcon>Settings</MenuItem>
      <MenuItem onClick={() => account(() => { if (handleLogout) handleLogout(); })}><ListItemIcon><LogOut size={17} /></ListItemIcon>Log out</MenuItem>
    </Menu>
  </Box>;
}

/** Desktop: a slim icon rail that always shows. Opening it slides over the page, so the page never reflows. */
export default function Sidebar({ changePage, ...props }) {
  const [expanded, setExpanded] = useState(false);
  const close = () => setExpanded(false);
  return <Box sx={{ display: "none", "@media (min-width: 900px)": { display: "block" }, flex: "none", position: "sticky", top: 0, width: RAIL_WIDTH, height: "100vh", zIndex: 1150 }}>
    <ClickAwayListener onClickAway={() => { if (expanded) close(); }}>
      <Box component="aside" onKeyDown={event => { if (event.key === "Escape") close(); }} sx={{
        position: "absolute", top: 0, bottom: 0, left: 0, width: expanded ? OPEN_WIDTH : RAIL_WIDTH, overflow: "hidden", bgcolor: "background.paper",
        boxShadow: expanded ? "8px 0 32px rgba(16, 24, 40, 0.16)" : "1px 0 10px rgba(16, 24, 40, 0.06)", transition: "width 200ms ease, box-shadow 200ms ease",
      }}>
        <SidebarContent {...props} expanded={expanded} onExpand={() => setExpanded(true)} onToggle={() => setExpanded(value => !value)}
          toggleLabel={expanded ? "Close menu" : "Open menu"} toggleIcon={expanded ? <X size={18} /> : <BurgerIcon />}
          onOpen={page => { close(); changePage(page); }} />
      </Box>
    </ClickAwayListener>
  </Box>;
}

/** Phones and small tablets: the same menu, opened from the burger in the top bar. */
export function MobileMenu({ open, onClose, changePage, ...props }) {
  return <Drawer anchor="left" open={open} onClose={onClose}
    PaperProps={{ role: "dialog", "aria-modal": true, "aria-label": "Menu", sx: { width: "min(84vw, 280px)", borderRadius: 0 } }}>
    <SidebarContent {...props} expanded onExpand={() => {}} onToggle={onClose} toggleLabel="Close menu" toggleIcon={<X size={18} />}
      onOpen={page => { onClose(); changePage(page); }} />
  </Drawer>;
}
