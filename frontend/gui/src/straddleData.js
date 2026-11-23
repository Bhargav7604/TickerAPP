// Straddle and strangle prices for the index option chains the OI recorder follows (backend/straddle.py).
const INDIA_OFFSET_SECONDS = 19800;

export function makeStraddleApi(request) {
  async function get(route, params, signal) {
    const result = await request(`${route}/?${new URLSearchParams(params)}`, "GET", null, true, false, true, signal);
    if (result?.type !== "success") throw new Error(result?.message || "Straddle data is unavailable right now.");
    return result;
  }
  return {
    expiries: (index, signal) => get("oi/expiries", { index }, signal),
    load: (index, expiry, day, signal) => get("straddle", { index, expiry, ...(day ? { day } : {}) }, signal),
  };
}

export const INDICES = [["nifty", "NIFTY"], ["banknifty", "BANKNIFTY"], ["finnifty", "FINNIFTY"], ["midcpnifty", "MIDCPNIFTY"], ["sensex", "SENSEX"]];

// Lines in legend order. ATM is the straddle; OTM n is the strangle n strikes out; ITM 1 is the pair one strike in.
export const LINES = [
  ["ATM", "ATM", "#e5484d"], ["OTM1", "OTM 1", "#f08c00"], ["OTM2", "OTM 2", "#2f9e44"], ["OTM3", "OTM 3", "#1c7ed6"],
  ["OTM4", "OTM 4", "#ae3ec9"], ["OTM5", "OTM 5", "#868e96"], ["OTM6", "OTM 6", "#74b816"], ["OTM7", "OTM 7", "#15aabf"],
  ["ITM1", "ITM 1", "#a61e4d"],
];
export const DEFAULT_LINES = ["ATM", "OTM1", "OTM2", "OTM3", "ITM1"];
export const TABLE_ORDER = ["ITM1", "ATM", "OTM1", "OTM2", "OTM3", "OTM4", "OTM5", "OTM6", "OTM7"];

const minuteOfDay = seconds => Math.floor((seconds + INDIA_OFFSET_SECONDS) / 60) % 1440;

/** The day's points at a coarser interval: every point on the minute grid, plus the first and the latest. */
export function sampleEvery(series, minutes) {
  if (!series || minutes <= 3) return series;
  const keep = series.times.map((time, index) => index === 0 || index === series.times.length - 1 || minuteOfDay(time) % minutes === 0);
  const pick = values => values.filter((_, index) => keep[index]);
  return { times: pick(series.times), spot: pick(series.spot), synthetic: pick(series.synthetic), atm: pick(series.atm),
    lines: Object.fromEntries(Object.entries(series.lines).map(([key, values]) => [key, pick(values)])) };
}

/** {value, change, pct, since} for the ATM straddle against its first price of the day, or null. */
export function changeSinceOpen(series, current) {
  const values = series?.lines?.ATM || [];
  const first = values.findIndex(value => Number.isFinite(value));
  const now = current?.rows?.find(row => row.key === "ATM")?.total;
  if (first < 0 || !Number.isFinite(now)) return null;
  const change = now - values[first];
  return { value: now, change, pct: values[first] ? change / values[first] * 100 : null, since: series.times[first] };
}

/** Whether an alert should fire: the straddle at or beyond the level in the chosen direction. */
export const alertHit = (alert, value) => Boolean(alert?.armed && Number.isFinite(alert.level) && Number.isFinite(value)
  && (alert.direction === "above" ? value >= alert.level : value <= alert.level));
