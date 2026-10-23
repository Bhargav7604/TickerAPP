export const OI_INDEXES = [["nifty", "NIFTY"], ["banknifty", "BANKNIFTY"], ["sensex", "SENSEX"]];

export function makeOiApi(request) {
  async function get(route, params, signal) {
    const result = await request(`oi/${route}/?${new URLSearchParams(params)}`, "GET", null, true, false, true, signal);
    if (result?.type !== "success") throw new Error(result?.message || "OI data unavailable.");
    return result;
  }
  return {
    expiries: (index, signal) => get("expiries", { index }, signal),
    chain: (index, expiry, signal) => get("chain", { index, expiry }, signal),
    liveChain: (index, expiry, signal) => get("live-chain", { index, expiry }, signal),
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
