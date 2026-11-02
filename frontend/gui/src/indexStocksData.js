export const STOCK_INDEXES = [["nifty", "NIFTY 50"], ["banknifty", "BANK NIFTY"], ["sensex", "SENSEX"]];
const INDEX_KEY = "utraders-index-stocks";

export function makeIndexStocksApi(request) {
  return {
    load: async (index, signal) => {
      const result = await request(`index-stocks/?${new URLSearchParams({ index })}`, "GET", null, true, false, true, signal);
      if (result?.type !== "success") throw new Error(result?.message || "Stock prices are unavailable right now.");
      return result;
    },
  };
}

export const readStockIndex = () => {
  try {
    const value = localStorage.getItem(INDEX_KEY);
    return STOCK_INDEXES.some(([key]) => key === value) ? value : "nifty";
  } catch {
    return "nifty";
  }
};
export const saveStockIndex = index => {
  try { localStorage.setItem(INDEX_KEY, index); } catch { /* storage unavailable */ }
};

const finite = value => typeof value === "number" && Number.isFinite(value);
export const price = value => finite(value) ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "--";
export const signedPct = value => finite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "--";
export const signedNumber = value => finite(value) ? `${value > 0 ? "+" : ""}${Math.round(value).toLocaleString("en-IN")}` : "--";
export const whole = value => finite(value) ? Math.round(value).toLocaleString("en-IN") : "--";
export const tone = value => finite(value) ? value > 0 ? "is-up" : value < 0 ? "is-down" : "" : "";
export const clock = seconds => finite(seconds)
  ? new Date(seconds * 1000).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" })
  : "--:--:--";
export const BUILDUP_NAMES = { LB: "Long build-up", SB: "Short build-up", SC: "Short covering", LU: "Long unwinding" };
