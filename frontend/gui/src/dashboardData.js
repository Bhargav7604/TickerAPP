export const DASHBOARD_CHARTS = [
  { id: "dow", label: "Dow Futures", source: "tradingview" },
  { id: "nifty-fut", label: "Nifty 50 Futures" },
  { id: "banknifty", label: "Bank Nifty" },
  { id: "india-vix", label: "India VIX" },
  { id: "crude-oil", label: "Crude Oil" },
  { id: "usd-inr", label: "USD / INR", precision: 4 },
];
export const DEFAULT_ORDER = DASHBOARD_CHARTS.map(chart => chart.id);
export const CANDLE_SIZES = [["minute", "1m"], ["5minute", "5m"], ["15minute", "15m"], ["60minute", "1h"], ["day", "1D"]];
const ORDER_KEY = "utraders-dashboard-order";
const SIZES_KEY = "utraders-dashboard-intervals";

export function makeDashboardApi(request) {
  async function get(route, signal) {
    const result = await request(route, "GET", null, true, false, true, signal);
    if (result?.type !== "success") throw new Error(result?.message || "Live prices are unavailable right now.");
    return result;
  }
  return {
    quotes: signal => get("dashboard/quotes/", signal),
    candles: (id, interval, signal) => get(`dashboard/candles/?${new URLSearchParams({ id, interval })}`, signal),
  };
}

/** Saved order, with unknown charts dropped and any new chart added at the end. */
export function readOrder() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(ORDER_KEY)) || []; } catch { saved = []; }
  const known = Array.isArray(saved) ? saved.filter((id, index) => DEFAULT_ORDER.includes(id) && saved.indexOf(id) === index) : [];
  return [...known, ...DEFAULT_ORDER.filter(id => !known.includes(id))];
}
export const saveOrder = order => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch { /* storage unavailable */ } };

export function readSizes() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIZES_KEY)) || {};
    return Object.fromEntries(Object.entries(saved).filter(([, size]) => CANDLE_SIZES.some(([value]) => value === size)));
  } catch { return {}; }
}
export const saveSizes = sizes => { try { localStorage.setItem(SIZES_KEY, JSON.stringify(sizes)); } catch { /* storage unavailable */ } };
