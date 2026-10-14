// Imported only by the explicitly enabled local design preview.
const stocks = [
  ["RELIANCE", 1408.20, .82, 500], ["HDFCBANK", 962.15, -.35, 550],
  ["ICICIBANK", 1355.60, .54, 700], ["INFY", 1512.40, -.68, 400],
  ["SBIN", 852.30, 1.12, 750], ["TCS", 3062.50, .31, 175],
  ["AXISBANK", 1142.80, -.22, 625], ["LT", 3680.20, .64, 175],
];

export function makeEquityPreviewApi(indexOptions = false) {
  const instruments = indexOptions ? [["NIFTY", 22555, .25, 65], ["BANKNIFTY", 55270, -.4, 30], ["SENSEX", 72542, .45, 20]] : stocks;
  const contracts = [], quotes = {};
  const base = new Date();
  const day = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 11, 25);
  const add = (stock, month, kind, strike = 0) => {
    const [underlying, price, change, lotSize] = stock;
    const expiry = new Date(base.getFullYear(), base.getMonth() + month, 27, 12);
    const iso = `${expiry.getFullYear()}-${String(expiry.getMonth() + 1).padStart(2, "0")}-27`;
    const symbol = `${underlying}${String(expiry.getFullYear()).slice(-2)}${expiry.toLocaleDateString("en-GB", { month: "short" }).toUpperCase()}${kind === "FUT" ? "FUT" : strike + kind}`;
    const id = (underlying === "SENSEX" ? "BFO:" : "NFO:") + symbol;
    contracts.push({ id, symbol, underlying, expiry: iso, kind, strike, lotSize, tickSize: .05 });
    const ltp = kind === "FUT" ? price + month * 7.15 : (kind === "CE" ? 34.25 : 23.10) + month * 2.5 + Math.abs(strike - price) * .02;
    const changePct = kind === "FUT" ? change : kind === "CE" ? 5.06 : -3.14;
    quotes[id] = { ltp, changePct, change: ltp - ltp / (1 + changePct / 100), bid: ltp - .20, ask: ltp + .25,
      volumeLots: 12436 + contracts.length * 317, oiLots: 215320 - contracts.length * 597,
      quotedAt: day.toISOString(), fetchedAt: Date.now() / 1000, stale: false,
      ohlc: { open: ltp * .992, high: ltp * 1.005, low: ltp * .987, close: ltp / (1 + changePct / 100) },
      depth: {
        buy: Array.from({ length: 5 }, (_, i) => ({ price: ltp - .20 - i * .05, lots: 2548 + i * 317 })),
        sell: Array.from({ length: 5 }, (_, i) => ({ price: ltp + .25 + i * .05, lots: 1936 + i * 403 })),
      },
    };
  };
  instruments.forEach(stock => [0, 1, 2].forEach(month => {
    if (!indexOptions) add(stock, month, "FUT");
    const step = indexOptions && stock[0] !== "NIFTY" ? 100 : 50;
    const strike = Math.round(stock[1] / step) * step;
    [-step, 0, step].forEach(delta => ["CE", "PE"].forEach(kind => add(stock, month, kind, strike + delta)));
  }));
  return {
    preview: true,
    contracts: async ({ kind = "FUT", ids, q = "", underlying, expiry, strike = "", option_type = "all", page = 0 } = {}) => {
      if (kind === "options") {
        const stocks = [...new Set(contracts.filter(row => row.kind !== "FUT").map(row => row.underlying))].sort();
        underlying = underlying || (indexOptions ? "NIFTY" : "RELIANCE");
        let rows = contracts.filter(row => row.kind !== "FUT" && row.underlying === underlying);
        const expiries = [...new Set(rows.map(row => row.expiry))].sort();
        expiry = expiry || expiries[0];
        rows = rows.filter(row => row.expiry === expiry);
        const strikes = [...new Set(rows.map(row => row.strike))].sort((a, b) => a - b);
        rows = rows.filter(row => (strike === "" || row.strike === Number(strike)) && (option_type === "all" || row.kind === option_type))
          .sort((a, b) => a.strike - b.strike || a.kind.localeCompare(b.kind));
        return { type: "success", contracts: rows.slice(page * 49, (page + 1) * 49), total: rows.length,
          filters: { [indexOptions ? "indices" : "stocks"]: indexOptions ? instruments.map(row => row[0]) : stocks, expiries, strikes, underlying, expiry, strike } };
      }
      const rows = contracts.filter(contract => ids ? ids.split(",").includes(contract.id) :
        (kind === "all" || contract.kind === kind) && q.toUpperCase().replace(/(\d),(?=\d)/g, "$1").split(/\s+/).every(word => ["FUT", "CE", "PE"].includes(word) ? contract.kind === word : `${contract.underlying} ${contract.symbol} ${contract.strike} ${contract.kind}`.includes(word)));
      return { type: "success", contracts: rows.slice(0, kind === "FUT" ? 1000 : 50), total: rows.length };
    },
    quotes: async ids => ({ type: "success", status: "sample", quotes: Object.fromEntries(ids.filter(id => quotes[id]).map(id => [id, { ...quotes[id], fetchedAt: Date.now() / 1000 }])) }),
    history: async id => {
      const quote = quotes[id];
      const start = new Date(day); start.setHours(9, 15, 0, 0);
      const price = i => quote.ltp * (.993 + i * .00026 + Math.sin(i * 1.7) * .00065);
      return { type: "success", candles: quote ? Array.from({ length: 27 }, (_, i) => {
        const open = price(i - 1), close = price(i);
        return { time: start.getTime() / 1000 + i * 300, open, close,
          high: Math.max(open, close) + quote.ltp * .00035, low: Math.min(open, close) - quote.ltp * .00025,
          volume: 400 + (i * 173) % 700 };
      }) : [] };
    },
  };
}
