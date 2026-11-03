import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { CssBaseline, ThemeProvider as MuiThemeProvider } from "@mui/material";
import { makeTheme } from "./ui/theme";
import "./theme.css";

export const THEME_KEY = "index-tool-theme-v1";
// Light is the default look; an explicit "dark" choice is remembered per browser.
const normalizeTheme = value => value === "dark" ? "dark" : "light";
export const ThemeContext = createContext({ theme: "light", toggleTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return normalizeTheme(localStorage.getItem(THEME_KEY)); }
    catch { return "light"; }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0a0f1a" : "#f3f5fa");
  }, [theme]);
  useEffect(() => {
    const syncTheme = event => { if (event.key === THEME_KEY || event.key === null) setTheme(normalizeTheme(event.newValue)); };
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);
  const muiTheme = useMemo(() => makeTheme(theme), [theme]);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* Theme still works when browser storage is unavailable. */ }
  };
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>
    <MuiThemeProvider theme={muiTheme}><CssBaseline />{children}</MuiThemeProvider>
  </ThemeContext.Provider>;
}
