export const OI_INDEXES = [["nifty", "NIFTY"], ["banknifty", "BANKNIFTY"], ["finnifty", "FINNIFTY"], ["midcpnifty", "MIDCPNIFTY"], ["sensex", "SENSEX"]];

export function makeOiApi(request) {
  async function get(route, params, signal) {
    const result = await request(`oi/${route}/?${new URLSearchParams(params)}`, "GET", null, true, false, true, signal);
    if (result?.type !== "success") throw new Error(result?.message || "OI data unavailable.");
    return result;
  }
  return {
    expiries: (index, signal) => get("expiries", { index }, signal),
    chain: (index, expiry, window, range, signal) => get("chain", { index, expiry, window, range }, signal),
    liveChain: (index, expiry, window, range, signal) => get("live-chain", { index, expiry, window, range }, signal),
    trend: (index, expiry, interval, strikes, signal) => get("trend", { index, expiry, interval, strikes }, signal),
  };
}

const finite = value => typeof value === "number" && Number.isFinite(value);

export const formatOi = value => finite(value) ? Math.round(value).toLocaleString("en-IN") : "--";
export const formatSignedOi = value => finite(value) ? `${value > 0 ? "+" : ""}${Math.round(value).toLocaleString("en-IN")}` : "--";
export const formatPrice = value => finite(value) ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--";
export const formatSignedPrice = value => finite(value) ? `${value > 0 ? "+" : ""}${formatPrice(value)}` : "--";
export const formatRatio = value => finite(value) ? value.toFixed(2) : "--";
export const formatPct = value => finite(value) ? `${value > 0 ? "+" : ""}${value}%` : "--";

// Lakh / crore shorthand for chart axes and summary cards, e.g. 4.40 Cr.
export const compactOi = value => {
  if (!finite(value)) return "--";
  const size = Math.abs(value);
  if (size >= 1e7) return `${(value / 1e7).toFixed(2)} Cr`;
  if (size >= 1e5) return `${(value / 1e5).toFixed(2)} L`;
  return Math.round(value).toLocaleString("en-IN");
};

export const signClass = value => finite(value) && value !== 0 ? (value > 0 ? "oi-up" : "oi-down") : "";

export const timeLabel = seconds => new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });

export const BUILDUP_SHORT = { "Long Build-up": "LB", "Short Build-up": "SB", "Long Unwinding": "LU", "Short Covering": "SC" };

// Short-term OI change windows; OI is recorded every three minutes, so these are its multiples.
export const OI_CHANGE_WINDOWS = [[3, "3m"], [6, "6m"], [15, "15m"], [30, "30m"], [60, "1h"]];
const WINDOW_KEY = "utraders-oi-change-window";
export const readChangeWindow = () => {
  try { const value = Number(localStorage.getItem(WINDOW_KEY)); return OI_CHANGE_WINDOWS.some(([minutes]) => minutes === value) ? value : 15; }
  catch { return 15; }
};
export const saveChangeWindow = minutes => { try { localStorage.setItem(WINDOW_KEY, String(minutes)); } catch { /* storage unavailable */ } };

// The chain's short form: 3.0k, 15.5k, 1.8L, 1.62Cr.
export const shortOi = value => {
  if (!finite(value)) return "--";
  const size = Math.abs(value);
  if (size >= 1e7) return `${(value / 1e7).toFixed(2)}Cr`;
  if (size >= 1e5) return `${(value / 1e5).toFixed(1)}L`;
  if (size >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return Math.round(value).toLocaleString("en-IN");
};

export const signedShortOi = value => finite(value) ? `${value > 0 ? "+" : ""}${shortOi(value)}` : "--";
export const STRIKE_RANGES = [["atm", "ATM ±12"], ["all", "Whole chain"]];
const RANGE_KEY = "utraders-oi-strike-range";
export const readStrikeRange = () => { try { return localStorage.getItem(RANGE_KEY) === "all" ? "all" : "atm"; } catch { return "atm"; } };
export const saveStrikeRange = range => { try { localStorage.setItem(RANGE_KEY, range); } catch { /* storage unavailable */ } };

