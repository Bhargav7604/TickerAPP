export const PREVIEW_TIME = new Date("2026-10-09T14:35:00+05:30").getTime();
const KEYS = ["nifty", "banknifty", "sensex"];
const BASES = [25206.8, 56842.5, 82614.7];
const SPOTS = [25150.2, 56720.1, 82490.3];
const LOTS = [1262, -438, 214];

export function makeDesignData(contractMonth = "current") {
  const offset = ["current", "next", "far"].indexOf(contractMonth);
  const month = ["OCT", "NOV", "DEC"][offset];
  const monthNumber = ["10", "11", "12"][offset];
  const settings = { contractMonth, alertsEnabled: true, alertLotThreshold: 25, alertEmail: "", symbols: {} };
  const chartHistory = {};
  const data = {};
  const rawPrice = (i, k) => i * (1.35 + k * 0.7) + Math.sin(i * 0.6) * (5 + k * 4);
  const rawLots = (i, k) => i * (28 - k * 7) + Math.sin(i * 0.8 + k) * (115 - k * 20);
  KEYS.forEach((key, k) => {
    const symbol = key.toUpperCase() + "26" + month + "FUT";
    const cmp = Number((BASES[k] + offset * (82 + k * 34)).toFixed(1));
    const lot = LOTS[k] + offset * (k === 1 ? -134 : 86);
    settings.symbols[key] = { symbol, expiry: "2026-" + monthNumber + "-" + (k === 2 ? "29" : "27"), lotSize: [65, 30, 20][k] };
    data[key + "Data"] = { symbol, cmp, lot, ratio: [1.18, 0.94, 1.06][k], vwap: [42.6, -65.2, 88.3][k],
      lotSize: [65, 30, 20][k], oi: [218420, 102380, 64210][k], netDemand: lot * [65, 30, 20][k],
      open: cmp - 86, high: cmp + 42, low: cmp - 130, netChange: cmp - SPOTS[k], pctChange: 0.49,
      oiDayHigh: [224190, 108960, 66140][k], oiDayLow: [209650, 98180, 60830][k] };
    chartHistory[key] = Array.from({ length: 68 }, (_, i) => ({
      symbol, time: PREVIEW_TIME - (67 - i) * 300000,
      indexLevel: Number((cmp + rawPrice(i, k) - rawPrice(67, k)).toFixed(1)),
      netLots: Math.round(lot + rawLots(i, k) - rawLots(67, k)),
      ratio: Number((data[key + "Data"].ratio + (Math.sin(i) - Math.sin(67)) * 0.03).toFixed(2))
    }));
  });
  return { ...data, settings, chartHistory,
    spotPrices: Object.fromEntries(KEYS.map((key, i) => [key, SPOTS[i]])),
    snapshotHeartbeat: { status: "closed", label: "Previous session", latestSnapshotTime: PREVIEW_TIME, marketOpen: false },
    feedStatus: "live", marketTime: PREVIEW_TIME, previewLabel: "Demo data",
    acDdSignals: { byTimeframe: {}, thresholds: { priceChangePct: 0.2, volumeDiffPct: 250 } } };
}
