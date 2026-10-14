export const MARKET_COLUMNS = [
  { id: "futures", label: "Futures", unit: "pts", width: 110, mobileWidth: 82 },
  { id: "spot", label: "Spot", unit: "pts", width: 110, mobileWidth: 88 },
  { id: "difference", label: "Futures - Spot", heading: "F - S", unit: "pts", width: 90, mobileWidth: 62 },
  { id: "netLots", label: "Net lots", width: 100, mobileWidth: 76 },
  { id: "ratio", label: "D/S ratio", width: 88, mobileWidth: 80 },
  { id: "vwap", label: "Away from VWAP", unit: "pts", width: 146, mobileWidth: 140 },
  { id: "lotSize", label: "Lot size", width: 80, mobileWidth: 80 },
  { id: "oi", label: "OI", width: 100, mobileWidth: 92 },
  { id: "demandSupply", label: "Demand / Supply", width: 136, mobileWidth: 144 },
  { id: "ohlc", label: "Open / High / Low", width: 234, mobileWidth: 232 },
  { id: "oiRange", label: "OI high / low", width: 180, mobileWidth: 190 },
  { id: "change", label: "Change", unit: "pts / %", width: 148, mobileWidth: 148 },
];

export const DEFAULT_MARKET_COLUMNS = MARKET_COLUMNS.slice(0, 8).map(column => column.id);
export const ESSENTIAL_MARKET_COLUMNS = ["futures", "difference", "netLots"];

export function selectedMarketColumns(value) {
  const byId = new Map(MARKET_COLUMNS.map(column => [column.id, column]));
  const selected = Array.isArray(value) ? [...new Set(value)].map(id => byId.get(id)).filter(Boolean) : [];
  return selected.length ? selected : MARKET_COLUMNS.filter(column => DEFAULT_MARKET_COLUMNS.includes(column.id));
}
