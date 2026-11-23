// Sample /api/news/ responses for tests and the design preview. Headlines and filings are invented examples.
const at = (date, time) => `${date}T${time}:00+05:30`;

const story = (id, source, section, published, title, summary, symbols = [], image = "") => ({
  id: `https://news.example.com/${id}`, url: `https://news.example.com/${id}`, title, summary, source, feed: source, section, published, symbols, image,
});
const filing = (id, company, symbol, group, subject, text, published) => ({
  id: `nse-${id}`, company, symbol, group, subject, text, published, url: `https://nsearchives.nseindia.com/corporate/sample-${id}.pdf`,
});

export function makeNewsPayload(date = "2026-11-23") {
  return {
    type: "success", message: "", updated: at(date, "14:30"),
    news: [
      story("tata-steel-deal", "Economic Times", "Markets", at(date, "14:05"), "Tata Steel dips 7% as APL Apollo tumbles on ₹28,000 crore deal",
        "Shares of Tata Steel fell after the company agreed to buy a stake in APL Apollo Tubes; analysts expect near-term pressure.", ["TATASTEEL"],
        "https://img.example.com/tata.jpg"),
      story("it-rally", "Mint", "Stock Market News", at(date, "13:40"), "TCS vs Infosys: why Indian IT stocks are rising despite the global AI sell-off",
        "Experts see rotation out of expensive AI hardware names into asset-light IT services companies.", ["TCS", "INFY"]),
      story("breadth", "The Hindu BusinessLine", "Markets", at(date, "12:52"), "IT holds firm as banks and metals drag Nifty lower",
        "Of 4,509 stocks traded on the BSE, 2,692 declined against 1,547 that advanced.", [], "https://img.example.com/breadth.jpg"),
      story("hdfc-bank", "Business Standard", "Markets", at(date, "11:15"), "HDFC Bank shares, Bank Nifty retreat sharply from record highs",
        "Private lenders led the fall in the banking index.", ["HDFCBANK"]),
      story("rupee", "Economic Times", "Forex", "2026-11-22T18:30:00+05:30", "Rupee retreats from a seven-month high on corporate dollar buying",
        "The rupee is on track for a monthly gain of over 2%.", []),
    ],
    announcements: [
      filing("1", "Dalmia Bharat Limited", null, "action", "Outcome of Board Meeting", "Outcome of Board Meeting held on 23-Nov-2026 for Buy-back", at(date, "14:25")),
      filing("2", "Tata Steel Limited", "TATASTEEL", "deals", "Acquisition", "Acquisition of equity stake in APL Apollo Tubes Limited", at(date, "09:05")),
      filing("3", "Infosys Limited", "INFY", "meetings", "Analysts/Institutional Investor Meet/Con. Call Updates", "Schedule of meet", at(date, "11:30")),
      filing("4", "Railtel Corporation Of India Limited", null, "orders", "Bagging/Receiving of orders/contracts", "", at(date, "11:00")),
      filing("5", "HDFC Bank Limited", "HDFCBANK", "rating", "Credit Rating", "Credit rating reaffirmed", at(date, "10:10")),
    ].sort((a, b) => b.published.localeCompare(a.published)),
    stocks: {
      TATASTEEL: { symbol: "TATASTEEL", company: "Tata Steel Ltd.", fno: true, n50: true, sensex: true, n500: true },
      TCS: { symbol: "TCS", company: "Tata Consultancy Services Ltd.", fno: true, n50: true, sensex: true, n500: true },
      INFY: { symbol: "INFY", company: "Infosys Ltd.", fno: true, n50: true, sensex: true, n500: true },
      HDFCBANK: { symbol: "HDFCBANK", company: "HDFC Bank Ltd.", fno: true, n50: true, sensex: true, n500: true },
    },
    sources: [
      { key: "et-markets", name: "Economic Times", ok: true, error: "", count: 2 },
      { key: "et-stocks", name: "Economic Times", ok: true, error: "", count: 0 },
      { key: "hbl", name: "The Hindu BusinessLine", ok: true, error: "", count: 1 },
      { key: "mint", name: "Mint", ok: true, error: "", count: 1 },
      { key: "bs", name: "Business Standard", ok: false, error: "timed out", count: 1 },
      { key: "nse", name: "NSE", ok: true, error: "", count: 5 },
    ],
  };
}

/** The design preview's news: the sample payload dated today, so "Today" counts and times read naturally. */
export function makeNewsPreviewApi() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return { load: () => new Promise(resolve => setTimeout(() => resolve(makeNewsPayload(today)), 80)) };
}
