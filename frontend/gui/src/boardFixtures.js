// Sample market data for tests and the local design preview. Deterministic: the same numbers every run.
import { INDICATORS } from "./boardData";

const SECTORS = ["Financial Services", "IT", "Oil & Gas", "Auto", "FMCG", "Healthcare", "Metals & Mining", "Capital Goods",
  "Telecom", "Power", "Realty", "Chemicals", "Consumer Durables", "Construction Materials"];
const NAMES = ["HDFCBANK", "ICICIBANK", "RELIANCE", "INFY", "TCS", "BHARTIARTL", "LT", "SBIN", "AXISBANK", "KOTAKBANK", "BAJFINANCE",
  "ITC", "HINDUNILVR", "MARUTI", "M&M", "TATAMOTORS", "SUNPHARMA", "CIPLA", "DRREDDY", "TATASTEEL", "JSWSTEEL", "HINDALCO", "NTPC",
  "POWERGRID", "ONGC", "COALINDIA", "ULTRACEMCO", "GRASIM", "ASIANPAINT", "TITAN", "HCLTECH", "WIPRO", "TECHM", "BAJAJ-AUTO",
  "EICHERMOT", "NESTLEIND", "BRITANNIA", "DLF", "GODREJPROP", "PIDILITIND", "SRF", "HAVELLS", "VOLTAS", "BEL", "HAL", "SIEMENS",
  "ABB", "TATAPOWER", "ADANIPORTS", "IOC", "BPCL", "GAIL", "PNB", "BANKBARODA", "CANBK", "IDFCFIRSTB", "FEDERALBNK", "AUBANK",
  "LUPIN", "AUROPHARMA", "DIVISLAB", "APOLLOHOSP", "PERSISTENT", "COFORGE", "MPHASIS", "LTIM", "VEDL", "NMDC", "SAIL", "JINDALSTEL",
  "AMBUJACEM", "ACC", "SHREECEM", "DALBHARAT", "INDUSTOWER", "IDEA", "TATACOMM", "OBEROIRLTY", "PRESTIGE", "PHOENIXLTD",
  "DEEPAKNTR", "AARTIIND", "PIIND", "UPL", "DIXON", "CROMPTON", "BLUESTARCO", "WHIRLPOOL", "TVSMOTOR", "HEROMOTOCO", "ASHOKLEY",
  "BHARATFORG", "MOTHERSON", "BOSCHLTD", "DABUR", "MARICO", "COLPAL", "GODREJCP", "TATACONSUM", "VBL", "ADANIGREEN", "NHPC",
  "TORNTPOWER", "CUMMINSIND", "POLYCAB", "KEI", "THERMAX", "SUZLON", "IRFC", "RVNL", "IRCTC", "ZYDUSLIFE", "ALKEM", "GLENMARK",
  "BIOCON", "KPITTECH", "TATAELXSI", "OFSS", "NATIONALUM", "HINDZINC", "RAMCOCEM", "JKCEMENT", "HFCL", "TEJASNET", "SOBHA",
  "BRIGADE", "NAVINFLUOR", "ATUL", "AMBER", "KAJARIACER", "CENTURYPLY", "SBILIFE", "HDFCLIFE", "ICICIGI", "CHOLAFIN", "SHRIRAMFIN",
  "MUTHOOTFIN", "PFC", "RECLTD", "LICHSGFIN", "ANGELONE", "BSE", "CDSL", "MCX", "PAYTM"];
const SENSEX = new Set(NAMES.slice(0, 30));
const N50 = new Set(NAMES.slice(0, 50));
const N100 = new Set(NAMES.slice(0, 95));

function random(seed) {
  let state = seed;
  return () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
}

export function makeBoardSnapshot({ minute = 245, status = "live" } = {}) {
  const rand = random(42);
  const fields = ["sym", "sector", "cap", "flags", "ltp", "prev", "open", "high", "low", "vwap", "volume", "avgVol", "prevH", "prevL",
    "hi52", "lo52", "oi", "prevOi", "flow", "flow30", "p30", "lc", "uc", "lot", "company"];
  const rows = NAMES.map((sym, i) => {
    const sector = SECTORS[i % SECTORS.length];
    const fno = i % 9 !== 7;
    const flags = (i < 140 ? 1 : 0) | (fno ? 2 : 0) | (N50.has(sym) ? 4 : 0) | (SENSEX.has(sym) ? 8 : 0);
    const prev = Math.round((200 + rand() * 4000) * 20) / 20;
    const tilt = (sector === "IT" || sector === "Capital Goods" ? 0.9 : sector === "Metals & Mining" || sector === "Realty" ? -1.1 : 0) + (rand() - 0.5) * 3.6;
    const ltp = Math.round(prev * (1 + tilt / 100) * 20) / 20;
    const open = Math.round(prev * (1 + (rand() - 0.5) * 0.024) * 20) / 20;
    const high = Math.max(ltp, open) * (1 + rand() * 0.006), low = Math.min(ltp, open) * (1 - rand() * 0.006);
    const vwap = (high + low + ltp) / 3;
    const avgVol = Math.round(2e5 + rand() * 6e6);
    const volume = Math.round(avgVol * (minute + 1) / 375 * (0.5 + rand() * (i % 11 === 3 ? 4 : 1.6)));
    const prevOi = fno ? Math.round(1e6 + rand() * 4e7) : null;
    const oi = fno ? Math.round(prevOi * (1 + (rand() - 0.45) * 0.12)) : null;
    const flow = Math.round(volume * vwap * (tilt / 4 + (rand() - 0.5) * 0.3));
    const company = sym.charAt(0) + sym.slice(1).toLowerCase() + " Ltd.";
    return [sym, sector, N100.has(sym) ? (i < 60 ? "Large" : "Mid") : i < 140 ? "Small" : "", flags, ltp, prev, open, +high.toFixed(2), +low.toFixed(2),
      +vwap.toFixed(2), volume, avgVol, +(prev * 1.012).toFixed(2), +(prev * 0.988).toFixed(2), +(prev * (1.05 + rand() * 0.3)).toFixed(2),
      +(prev * (0.65 + rand() * 0.25)).toFixed(2), oi, prevOi, flow, Math.round(flow * (0.1 + rand() * 0.3)), +(ltp * (1 - tilt / 400)).toFixed(2),
      fno ? null : +(prev * 0.8).toFixed(2), fno ? null : +(prev * 1.2).toFixed(2), fno ? 250 + (i % 7) * 125 : null, company];
  });
  // A few special cases the movers lists look for.
  rows[3][14] = rows[3][4];       // INFY at a 52-week high
  rows[19][15] = rows[19][4];     // TATASTEEL at a 52-week low
  const nifty = 23980.45;
  const coefficients = Object.fromEntries(NAMES.slice(0, 50).map((sym, i) => [sym, (0.11 - i * 0.0019) * nifty / rows[i][5] / 10]));
  return {
    type: "success", status, session: "2026-11-13", asOf: 1794560400, minute, paceFrac: (minute + 1) / 375, fields, rows,
    indices: [
      { key: "NIFTY", label: "NIFTY 50", ltp: nifty, prev: 23901.1, open: 23920, high: 24010.5, low: 23880.2, prevH: 24120, prevL: 23860, prevC: 23980 },
      { key: "SENSEX", label: "SENSEX", ltp: 78912.3, prev: 78701.2, open: 78750, high: 79010, low: 78620, prevH: 79100, prevL: 78500, prevC: 78701.2 },
      { key: "BANKNIFTY", label: "BANK NIFTY", ltp: 51874.2, prev: 52011.4, open: 52050, high: 52120, low: 51790, prevH: 52300, prevL: 51800, prevC: 52011.4 },
      { key: "FINNIFTY", label: "FIN NIFTY", ltp: 24120.6, prev: 24080.3, open: 24090, high: 24170, low: 24030, prevH: 24210, prevL: 23990, prevC: 24080.3 },
      { key: "MIDCPNIFTY", label: "MIDCAP SELECT", ltp: 12611.8, prev: 12540.1, open: 12550, high: 12640, low: 12520, prevH: 12600, prevL: 12480, prevC: 12540.1 },
      { key: "NIFTYNXT50", label: "NIFTY NEXT 50", ltp: 64210.5, prev: 64480.2, open: 64500, high: 64560, low: 64100, prevH: 64700, prevL: 64200, prevC: 64480.2 },
      { key: "NIFTY500", label: "NIFTY 500", ltp: 22140.7, prev: 22088.9, open: 22100, high: 22180, low: 22060, prevH: 22200, prevL: 22010, prevC: 22088.9 },
      { key: "INDIAVIX", label: "INDIA VIX", ltp: 13.42, prev: 14.01, open: 14.0, high: 14.2, low: 13.3, prevH: 14.5, prevL: 13.8, prevC: 14.01 },
    ],
    pcr: 1.12, weights: { nifty: coefficients, sensex: {} },
    calendar: [
      { index: "NIFTY", cycle: "Weekly", lot: 65, next: ["2026-11-17", "2026-11-24", "2026-12-01"], daysTo: 4 },
      { index: "BANKNIFTY", cycle: "Monthly", lot: 30, next: ["2026-11-23", "2026-12-29"], daysTo: 10 },
      { index: "FINNIFTY", cycle: "Monthly", lot: 60, next: ["2026-11-23", "2026-12-29"], daysTo: 10 },
      { index: "MIDCPNIFTY", cycle: "Monthly", lot: 120, next: ["2026-11-23", "2026-12-29"], daysTo: 10 },
      { index: "SENSEX", cycle: "Weekly", lot: 20, next: ["2026-11-19", "2026-11-26"], daysTo: 6 },
    ],
    holidays: { "2026-11-24": "Guru Nanak Jayanti", "2026-12-25": "Christmas" }, message: "",
  };
}

/** A scanner response for the same stocks: strong agreement for a handful, mixed for the rest. */
export function makeScanner(bars = 3, snapshot = makeBoardSnapshot()) {
  const rand = random(7);
  const rows = snapshot.rows.map(([sym, , , , ltp, prev], i) => {
    const bias = i % 6 === 0 ? 1 : i % 6 === 1 ? -1 : 0;
    const sides = INDICATORS.map(([id], j) => {
      if (id === "oi" && i % 9 === 7) return ".";
      if (bias && j < 3) return bias > 0 ? "+" : "-";
      const roll = rand();
      if (bias) return roll < 0.85 ? (bias > 0 ? "+" : "-") : "0";
      return roll < 0.35 ? "+" : roll < 0.7 ? "-" : "0";
    }).join("");
    const details = { vwap: [+((ltp - prev) / prev * 40).toFixed(2)], st: [+(ltp * (bias < 0 ? 1.006 : 0.994)).toFixed(2)], rsi: [bias > 0 ? 64 : bias < 0 ? 34 : 51],
      macd: [bias > 0 ? 0.42 : -0.31], orb: [+(prev * 1.004).toFixed(2), +(prev * 0.996).toFixed(2)], cpr: [+(prev * 0.998).toFixed(2), +(prev * 1.002).toFixed(2)],
      pdhl: [+(prev * 1.012).toFixed(2), +(prev * 0.988).toFixed(2)], vol: [+(1 + rand() * 2).toFixed(2)], oi: ["LB", 4.2], rs: [+((ltp - prev) / prev * 100 - 0.33).toFixed(2)],
      dr: [Math.round(rand() * 100)], sec: ["acc"] };
    const stop = bias > 0 ? +(ltp * 0.994).toFixed(2) : bias < 0 ? +(ltp * 1.006).toFixed(2) : null;
    const target = stop ? +(ltp + 2 * (ltp - stop)).toFixed(2) : null;
    return [sym, sides, details, stop, target];
  });
  return { type: "success", asOf: snapshot.asOf, minute: snapshot.minute, bars, indicators: INDICATORS.map(([id]) => id), core: ["vwap", "st", "ema"], rows, message: "" };
}

export function makeBoardPreviewApi() {
  const later = value => new Promise(resolve => setTimeout(() => resolve(value), 80));
  const snapshot = makeBoardSnapshot();
  return {
    snapshot: () => later(snapshot),
    scanner: bars => later(makeScanner(bars, snapshot)),
    candles: sym => {
      const row = snapshot.rows.find(r => r[0] === sym);
      const start = Math.floor(Date.UTC(2026, 10, 13, 3, 45) / 1000);
      let price = row ? row[5] : 1000;
      const candles = Array.from({ length: 82 }, (_, i) => {
        const open = price;
        price = +(price * (1 + Math.sin(i / 6) * 0.0015 + 0.0002)).toFixed(2);
        return { time: start + i * 180, open, high: Math.max(open, price) * 1.0008, low: Math.min(open, price) * 0.9992, close: price };
      });
      return later({ type: "success", symbol: sym, candles, message: "" });
    },
  };
}
