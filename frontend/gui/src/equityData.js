export const EQUITY_COLUMNS = [
  { id: "ltp", label: "LTP" }, { id: "changePct", label: "Change %" },
  { id: "bid", label: "Bid" }, { id: "ask", label: "Ask" },
  { id: "volumeLots", label: "Volume (lots)" }, { id: "oiLots", label: "OI (lots)" },
];
export const DEFAULT_EQUITY_COLUMNS = EQUITY_COLUMNS.map(column => column.id);
export const formatPrice = value => Number.isFinite(value)
  ? value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "\u2014";
export const formatLots = value => Number.isFinite(value)
  ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "\u2014";
export const formatChange = value => Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : "\u2014";
export const directionClass = value => value > 0 ? "eq-positive" : value < 0 ? "eq-negative" : "";
export const equityPollDelay = (response, normal) => Number.isFinite(response.retryAfterMs) && response.retryAfterMs > 0
  ? Math.max(250, Math.min(5000, response.retryAfterMs)) + 50 + Math.floor(Math.random() * 250) : normal;

export function isOlderEquityQuote(previous, next) {
  if (!previous || !next) return false;
  const before = Date.parse(previous.quotedAt), after = Date.parse(next.quotedAt);
  // Broker time takes priority: a newly fetched snapshot can still contain an older quote.
  if (Number.isFinite(before) && Number.isFinite(after) && before !== after) return after < before;
  return Number.isFinite(previous.fetchedAt) && Number.isFinite(next.fetchedAt) && next.fetchedAt < previous.fetchedAt;
}

export function reconcileEquityQuotes(previous, incoming, now = Date.now() / 1000) {
  // Missing quotes remain unavailable; only explicitly older snapshots retain the last value.
  return Object.fromEntries(Object.entries(incoming || {}).map(([id, quote]) => {
    const before = previous[id];
    if (!isOlderEquityQuote(before, quote)) return [id, quote];
    return [id, { ...before, stale: Boolean(before.stale || (Number.isFinite(before.fetchedAt) && now - before.fetchedAt > 15)) }];
  }));
}

export const expiryLabel = contract => new Date(contract.expiry + "T12:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
export const contractLabel = (contract, includeDay = false) => `${new Date(contract.expiry + "T12:00:00").toLocaleDateString("en-GB", { month: "short", ...(includeDay ? { day: "2-digit" } : {}) }).toUpperCase()} ${contract.kind === "FUT" ? "FUT" : `${formatLots(contract.strike)} ${contract.kind}`}`;

export function futuresForMonth(contracts, month) {
  const grouped = new Map();
  contracts.filter(contract => contract.kind === "FUT").forEach(contract => {
    const rows = grouped.get(contract.underlying) || [];
    rows.push(contract); grouped.set(contract.underlying, rows);
  });
  return [...grouped.values()].map(rows => rows.sort((a, b) => a.expiry.localeCompare(b.expiry))[month]).filter(Boolean);
}

export function readEquityPreferences(key, exchanges = ["NFO:"]) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    const lists = value?.lists?.filter(list => typeof list.id === "string" && typeof list.name === "string" && Array.isArray(list.ids))
      .slice(0, 10).map(list => ({ ...list, name: list.name.slice(0, 32), ids: [...new Set(list.ids.filter(id => typeof id === "string" && exchanges.some(exchange => id.startsWith(exchange))))].slice(0, 50) }));
    if (lists?.length) {
      const columns = [...new Set((value.columns || []).filter(id => DEFAULT_EQUITY_COLUMNS.includes(id)))];
      return { lists, activeList: lists.some(list => list.id === value.activeList) ? value.activeList : lists[0].id,
        columns: columns.length ? columns : DEFAULT_EQUITY_COLUMNS, depthOpen: value.depthOpen === true };
    }
  } catch (error) { /* A damaged or unavailable browser store must not block the terminal. */ }
  return { lists: [{ id: "default", name: "My watchlist", ids: [] }], activeList: "default", columns: DEFAULT_EQUITY_COLUMNS, depthOpen: false, initialise: true };
}

export function makeEquityApi(request, namespace = "equity") {
  async function get(route, params, signal) {
    const result = await request(`${namespace}/${route}/?${new URLSearchParams(params)}`, "GET", null, true, false, true, signal);
    if (result?.type !== "success") throw new Error(result?.message || "Market data unavailable.");
    return result;
  }
  return {
    contracts: (params, signal) => get("contracts", params, signal),
    quotes: (ids, signal) => get("quotes", { ids: ids.join(",") }, signal),
    history: (id, signal) => get("history", { ids: id }, signal),
  };
}
