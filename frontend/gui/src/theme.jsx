import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from "react";
import "./theme.css";

export const THEME_KEY = "index-tool-theme-v1";
// Dark is the Utraders brand default; an explicit "light" choice is remembered.
const normalizeTheme = value => value === "light" ? "light" : "dark";
export const ThemeContext = createContext({ theme: "dark", toggleTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return normalizeTheme(localStorage.getItem(THEME_KEY)); }
    catch { return "dark"; }
  });
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    const syncTheme = event => { if (event.key === THEME_KEY || event.key === null) setTheme(normalizeTheme(event.newValue)); };
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* Theme still works when browser storage is unavailable. */ }
  };
  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
