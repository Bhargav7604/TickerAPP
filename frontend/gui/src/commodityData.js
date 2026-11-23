// The Commodity view of Home: MCX futures shown the way the Indian market is shown.
import { useEffect, useRef, useState } from "react";
import { withArrow } from "./trend";

export const MARKETS = [["india", "Indian market"], ["commodity", "Commodity"]];
export const COMMODITY_KEYS = [["crudeoil", "Crude Oil"], ["naturalgas", "Natural Gas"], ["gold", "Gold"], ["silver", "Silver"], ["copper", "Copper"], ["zinc", "Zinc"]];
export const MONTHS = [["current", "Current"], ["next", "Next"], ["far", "Far"]];
const MARKET_KEY = "utraders-market";

export const readMarket = () => { try { return localStorage.getItem(MARKET_KEY) === "commodity" ? "commodity" : "india"; } catch { return "india"; } };
export const saveMarket = market => { try { localStorage.setItem(MARKET_KEY, market); } catch { /* storage unavailable */ } };

export function makeCommodityApi(request) {
  async function get(route, signal) {
    const result = await request(route, "GET", null, true, false, true, signal);
    if (result?.type !== "success") throw new Error(result?.message || "Commodity data is unavailable right now.");
    return result;
  }
  const query = params => new URLSearchParams(params).toString();
  return {
    decision: signal => get("commodities/home/", signal),
    overview: signal => get("commodities/overview/", signal),
    insights: signal => get("commodities/insights/", signal),
    history: (key, month, signal) => get(`commodities/history/?${query({ key, month })}`, signal),
    board: (month, signal) => get(`commodities/?${query({ month })}`, signal),
    candles: (symbol, interval, signal) => get(`commodities/candles/?${query({ symbol, interval })}`, signal),
  };
}

const finite = value => typeof value === "number" && Number.isFinite(value);
export const price = (value, places = 2) => finite(value) ? value.toLocaleString("en-IN", { minimumFractionDigits: places, maximumFractionDigits: places }) : "--";
// Changes carry ▲ / ▼ in front; signedPctBare goes in brackets after a number that already has its arrow.
export const signed = (value, places = 2) => finite(value) ? withArrow(value, `${value > 0 ? "+" : ""}${price(value, places)}`, places) : "--";
export const signedPctBare = value => finite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "--";
export const signedPct = value => finite(value) ? withArrow(value, signedPctBare(value)) : "--";
export const whole = value => finite(value) ? Math.round(value).toLocaleString("en-IN") : "--";
export const signedWhole = value => finite(value) ? withArrow(value, `${value > 0 ? "+" : ""}${whole(value)}`, 0) : "--";
export const tone = value => finite(value) && value !== 0 ? (value > 0 ? "success.main" : "error.main") : "text.secondary";
export const placesFor = value => finite(value) && Math.abs(value) < 100 ? 2 : finite(value) && Math.abs(value) < 10000 ? 1 : 0;

/** Calls `load(signal)` now and again after `delay` ms (or the server's retry hint) while the tab is visible. */
export function usePoll(load, delay, deps) {
  const [state, setState] = useState({ data: null, error: "" });
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let stopped = false;
    let timer = null;
    const abort = new AbortController();
    const run = async () => {
      let wait = delay;
      if (document.visibilityState !== "hidden" || !timer) {
        try {
          const data = await loadRef.current(abort.signal);
          if (stopped) return;
          setState({ data, error: "" });
          if (data?.retryAfterMs) wait = Math.max(500, data.retryAfterMs);
        } catch (exc) {
          if (stopped || exc.name === "AbortError") return;
          setState(previous => ({ ...previous, error: exc.message }));
        }
      }
      if (!stopped) timer = setTimeout(run, wait);
    };
    run();
    return () => { stopped = true; abort.abort(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delay, ...deps]);
  return state;
}
