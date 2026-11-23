// Sample option chain and index signals for the Home tests and the local design preview.
const STRIKES = [25250, 25300, 25350, 25400, 25450, 25500, 25550, 25600, 25650];

export function makeChainPayload({ live = true } = {}) {
  return {
    type: "success", live, expiry: "2026-11-24", underlying: 25448.6, atm: 25450, totals: { pcr: 0.94 },
    rows: STRIKES.map((strike, i) => ({ strike,
      call: { oi: 1e6 + i * 1e5, oiChange: 2e4 - i * 5e3, ltp: 300 - i * 30 },
      put: { oi: 2e6 - i * 1e5, oiChange: -1e4 + i * 4e3, ltp: 20 + i * 30 } })),
  };
}

const card = (key, label, price, pct, light, direction, players) => ({
  key, label, symbol: `${label}26NOVFUT`, price, change: { value: Math.round(price * pct) / 100, pct, since: "yesterday" },
  asOf: Math.floor(Date.parse("2026-11-23T14:30:00+05:30") / 1000), late: false, live: true,
  direction: { code: direction[0], label: direction[1], detail: "Sample data." },
  bigPlayers: { code: players[0], label: players[1], detail: "Sample data." },
  trap: null, light: { color: light[0], label: light[1], reasons: ["Sample data."] },
  range: null, expiryLevel: null, expiry: { date: "2026-11-24", isToday: false }, numbers: { netLots: null, oi: null, pcr: 0.94 },
});

export function makeDecisionPayload() {
  const expiry = [{ date: "2026-11-24", label: "Tomorrow" }, { date: "2026-12-01", label: "Tue 01 Dec" }];
  return {
    type: "success", mustKnow: [], calendar: { nifty: expiry, banknifty: expiry, sensex: [{ date: "2026-11-27", label: "Fri 27 Nov" }] },
    expiryToday: [], marketOpen: true, lastHour: false, closesAt: Math.floor(Date.parse("2026-11-23T15:30:00+05:30") / 1000),
    now: Math.floor(Date.parse("2026-11-23T14:30:00+05:30") / 1000), disclaimer: "Sample data for the design preview.", optionCost: null, cards: [
      card("nifty", "NIFTY", 25448.6, -0.52, ["red", "Risky time. Better to wait."], ["down", "Going down"], ["selling", "Big players are selling"]),
      card("banknifty", "BANKNIFTY", 56120, 0.31, ["green", "Good time to trade."], ["up", "Going up"], ["buying", "Big players are buying"]),
      card("sensex", "SENSEX", 83510.2, -0.18, ["yellow", "Unclear. Trade small."], ["flat", "Going nowhere"], ["mixed", "Big players are not clearly on one side"]),
    ],
  };
}

export const makeOiPreviewApi = () => ({
  expiries: async () => ({ type: "success", expiries: ["2026-11-24", "2026-12-01"], recorded: ["2026-11-24"] }),
  liveChain: async () => makeChainPayload(),
  chain: async () => makeChainPayload({ live: false }),
  trend: async () => ({ type: "success", rows: [] }),
});
export const makeDecisionPreviewApi = () => ({
  decision: async () => makeDecisionPayload(),
  contribution: async () => { throw new Error("Sector contribution is not in the sample data."); },
  candles: async () => ({ type: "success", candles: [] }),
});
