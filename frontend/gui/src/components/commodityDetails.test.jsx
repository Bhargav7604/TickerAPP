import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import CommodityDetails, { INTERNATIONAL } from "./commodityDetails";
import { placesFor, readMarket, saveMarket, signedWhole } from "../commodityData";

jest.mock("lightweight-charts", () => ({ createChart: jest.fn(), CandlestickSeries: "candles", LineSeries: "line", AreaSeries: "area",
  HistogramSeries: "histogram", ColorType: { Solid: "solid" } }));
const { createChart } = require("lightweight-charts");
const added = [];

beforeEach(() => {
  added.length = 0;
  createChart.mockImplementation(() => ({
    addSeries: (kind, options) => { const series = { kind, options, setData: jest.fn(), update: jest.fn(), applyOptions: jest.fn() }; added.push(series); return series; },
    removeSeries: jest.fn(), applyOptions: jest.fn(), remove: jest.fn(),
    timeScale: () => ({ fitContent: jest.fn(), setVisibleLogicalRange: jest.fn() }),
  }));
  localStorage.clear();
});

const month = (name, symbol, ltp, change, buy, sell) => ({ month: name, symbol, expiry: "2026-12-18", ltp, change, changePct: +(change / (ltp - change) * 100).toFixed(2),
  netLots: buy - sell, demandSupply: +(buy / sell).toFixed(2), buyQty: buy, sellQty: sell, oi: 12000, volume: 45000 });
const overview = { type: "success", asOf: 1795000000, commodities: [
  { key: "crudeoil", label: "CRUDE OIL", months: [month("current", "CRUDEOIL26DECFUT", 5510, 60, 900, 300), month("next", "CRUDEOIL27JANFUT", 5530, 55, 50, 200),
    month("far", "CRUDEOIL27FEBFUT", 5550, 50, 20, 20)] },
  { key: "gold", label: "GOLD", months: [month("current", "GOLD26DECFUT", 98200, -500, 100, 700)] },
], session: { open: true, opensAt: "09:00", closesAt: "23:55" } };
const boardRow = (name, label, group, symbol, ltp, change, extra = {}) => ({ name, label, group, unit: "", symbol, expiry: "2026-12-18", daysToExpiry: 28, ltp,
  change, changePct: +(change / (ltp - change) * 100).toFixed(2), prevClose: ltp - change, open: ltp - change, high: ltp + 10, low: ltp - change - 10,
  volume: 5000, oi: 3000, oiChangePct: 4.2, buildup: change >= 0 ? "LB" : "SB", prevHigh: 5500, prevLow: 5350, prevSessionClose: 5450, ...extra });
const board = (ltp = 5510) => ({ type: "success", month: "near", groups: ["Bullion", "Energy", "Base metals", "Agri", "Indices", "Other"],
  session: { open: true, opensAt: "09:00", closesAt: "23:55" }, asOf: 1795000000, rows: [
    boardRow("GOLD", "Gold", "Bullion", "GOLD26DECFUT", 98200, -500, { unit: "₹/10 g" }),
    boardRow("CRUDEOIL", "Crude Oil", "Energy", "CRUDEOIL26DECFUT", ltp, 60, { unit: "₹/bbl" }),
    boardRow("COPPER", "Copper", "Base metals", "COPPER26NOVFUT", 1012.4, 3.1),
  ] });
const history = (key, monthName) => ({ type: "success", key, month: monthName, symbol: `${key.toUpperCase()}SYM`, label: key,
  points: [{ time: 1795000000, price: 5480, netLots: 120, vwap: 5470 }, { time: 1795000300, price: 5500, netLots: -40, vwap: 5475 }] });

function makeApi() {
  return {
    overview: jest.fn(async () => overview),
    history: jest.fn(async (key, monthName) => history(key, monthName)),
    board: jest.fn(async () => board()),
    candles: jest.fn(async () => ({ type: "success", candles: [{ time: 1795000000, open: 1, high: 2, low: 0.5, close: 1.5 }] })),
    insights: jest.fn(async () => ({ type: "success", items: [], cross: {} })),
  };
}

async function renderDetails(api = makeApi()) {
  await act(async () => { render(<CommodityDetails api={api} />); });
  return api;
}

test("formatting helpers and the remembered market choice", () => {
  expect(readMarket()).toBe("india");
  saveMarket("commodity");
  expect(readMarket()).toBe("commodity");
  expect([placesFor(13.42), placesFor(5510), placesFor(98200)]).toEqual([2, 1, 0]);
  expect(signedWhole(600)).toBe("▲\u00a0+600");
  expect(signedWhole(-150)).toBe("▼\u00a0-150");
  expect(signedWhole(0)).toBe("0");
});

test("market overview lists current, next and far contracts with net lots and demand/supply", async () => {
  await renderDetails();
  const crude = screen.getByRole("table", { name: "CRUDE OIL futures" });
  const rows = within(crude).getAllByRole("row").slice(1).map(row => within(row).getAllByRole("cell").map(cell => cell.textContent));
  expect(rows[0]).toEqual(["current18 Dec", "5,510.0", "▲\u00a0+1.10%", "▲\u00a0+600", "3.00", "12,000", "45,000"]);
  expect(rows[1][3]).toBe("▼\u00a0-150");
  expect(screen.getByRole("table", { name: "GOLD futures" })).toBeInTheDocument();
});

test("net lots vs price switches commodity, month and chart type", async () => {
  const api = await renderDetails();
  expect(api.history).toHaveBeenCalledWith("crudeoil", "current", expect.anything());
  const [priceSeries, lotSeries] = added.slice(-2);
  expect([priceSeries.kind, lotSeries.kind, lotSeries.options.priceScaleId]).toEqual(["line", "line", "left"]);
  expect(lotSeries.setData).toHaveBeenCalledWith([{ time: 1795000000, value: 120 }, { time: 1795000300, value: -40 }]);
  const panel = screen.getByRole("region", { name: "Commodity net lots vs price" });
  await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Gold" })); });
  await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Next" })); });
  expect(api.history).toHaveBeenLastCalledWith("gold", "next", expect.anything());
  expect(within(panel).getByRole("heading", { name: "Gold · Net lots vs price" })).toBeInTheDocument();
  added.length = 0;
  await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Columns" })); });
  expect(added.slice(-2).map(series => series.kind)).toEqual(["line", "histogram"]);
  expect(added[added.length - 1].setData.mock.calls[0][0][1].color).toBe("#e5484d");
  await act(async () => { fireEvent.click(within(panel).getByRole("button", { name: "Candles" })); });
  expect(api.candles).toHaveBeenCalledWith("GOLDSYM", "5minute", expect.anything());
  expect(added.map(series => series.kind)).toContain("candles");
});

test("every MCX future is grouped, flashes on a new price and opens its chart", async () => {
  jest.useFakeTimers();
  const api = makeApi();
  await renderDetails(api);
  const table = screen.getByRole("table", { name: "MCX futures" });
  expect(within(table).getAllByRole("row").map(row => row.textContent).filter(text => ["Bullion", "Energy", "Base metals"].includes(text)))
    .toEqual(["Bullion", "Energy", "Base metals"]);
  const crude = within(table).getByRole("row", { name: /^Crude Oil 5,510\.0/ });
  expect(within(crude).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["Crude Oil18 Dec · ₹/bbl", "5,510.0", "▲\u00a0+60.0", "▲\u00a0+1.10%", "5,520.0", "5,440.0", "5,000", "3,000", "▲\u00a0+4.20%", "LB"]);
  api.board.mockResolvedValue(board(5525));
  await act(async () => { jest.advanceTimersByTime(3100); });
  expect(within(table).getByRole("row", { name: /^Crude Oil 5,525\.0/ })).toBeInTheDocument();
  jest.useRealTimers();
  await act(async () => { fireEvent.click(within(table).getByRole("row", { name: /^Crude Oil/ })); });
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Crude Oil" })).toBeInTheDocument();
  expect(api.candles).toHaveBeenCalledWith("CRUDEOIL26DECFUT", "5minute", expect.anything());
  expect(within(dialog).getByText(/Pivots from the previous session · R2 5,583\.3 · R1 5,516\.7 · P 5,433\.3/)).toBeInTheDocument();
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "1h" })); });
  expect(api.candles).toHaveBeenLastCalledWith("CRUDEOIL26DECFUT", "60minute", expect.anything());
  await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Close chart" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next month" })); });
  expect(api.board).toHaveBeenLastCalledWith("next", expect.anything());
});

test("international prices come from TradingView", async () => {
  await renderDetails();
  const frame = screen.getByTitle("International commodity prices from TradingView");
  expect(frame.getAttribute("src")).toMatch(/^https:\/\/s\.tradingview\.com\/embed-widget\/market-quotes\//);
  expect(INTERNATIONAL.flatMap(group => group.symbols.map(([, name]) => name))).toEqual(
    ["Brent crude", "WTI crude", "Natural gas", "Gold", "Silver", "Copper", "USD/INR", "Dollar index"]);
});

const insight = (key, label, name, extra = {}) => ({ key, name, label, symbol: `${name}26DECFUT`, ltp: 5330, prevClose: 5300, change: 30, changePct: 0.57, sessions: 60,
  trend: { sma20: 5197.5, sma50: 5122.5, aboveSma20: true, aboveSma50: true, change5dPct: 0.9, fromHighPct: 0.28, read: "Uptrend: above its 20 and 50-day averages." },
  volatility: { dailyVolPct: 0.15, annualVolPct: 2.4, atr: 40, atrPct: 0.75, todayRange: 30, rangeUsedPct: 75, read: "Used 75% of a normal day's range: little room left today." },
  range: { low: 5292, high: 5308, spot: 5330, support: 5275, resistance: 5315, basis: "realized", iv: 2.4, text: `${label} will most likely stay between 5,292 and 5,308 today.` },
  levels: { P: 5295, R1: 5315, S1: 5275, R2: 5335, S2: 5255 },
  term: { spread: 30, spreadPct: 0.56, carryAnnualPct: 6.9, state: "contango", rolloverPct: 45, daysToExpiry: 28, read: "Contango: later months cost more." },
  positions: { oiChangePct: 10, buildup: "LB" }, lot: { lot: "100 barrels", perPoint: 100, contractValue: 533000, todayPerLot: 3000, atrPerLot: 4000 }, ...extra });

test("commodity analytics show the worked-out reads for each commodity and across them", async () => {
  const api = makeApi();
  api.insights = jest.fn(async () => ({ type: "success", items: [insight("crudeoil", "CRUDE OIL", "CRUDEOIL"), insight("zinc", "ZINC", "ZINC", { lot: null, range: null, levels: null })],
    cross: { goldSilver: { ratio: 85.22, average20: 83.05, read: "Above its 20-day average: silver is cheap against gold (gold is leading)." },
      copperGold: { gap: 1.0, read: "Copper beating gold by 1.00% today: industry demand and risk appetite are leading." }, crudeGas: null,
      rupee: { ltp: 94.3, changePct: 0.21, read: "Rupee weaker by 0.21%: MCX prices are in rupees." } } }));
  await renderDetails(api);
  const section = screen.getByRole("region", { name: "Commodity analytics" });
  expect(within(within(section).getByRole("article", { name: "Gold / Silver ratio" })).getByText("85.22 · avg 83.05")).toBeInTheDocument();
  expect(within(section).getByRole("article", { name: "Copper vs gold" })).toHaveTextContent("+1%");
  expect(within(section).getByRole("article", { name: "Crude vs natural gas" })).toHaveTextContent("Waiting for prices.");
  expect(within(section).getByRole("article", { name: "Rupee effect (USD/INR)" })).toHaveTextContent("94.3000 ▲ +0.21%");
  const crude = within(section).getByRole("article", { name: "CRUDE OIL insights" });
  ["Uptrend", "Contango", "Long build-up", "₹100 per point", "+₹3,000", "₹4,000", "75%", "45%", "6.9%"].forEach(text => expect(within(crude).getAllByText(text, { exact: false }).length).toBeGreaterThan(0));
  expect(within(crude).getByText("Support (S1) · Resistance (R1)").nextSibling).toHaveTextContent("5,275.0 · 5,315.0");
  expect(within(crude).getByRole("meter", { name: "CRUDE OIL range used today" })).toHaveAttribute("aria-valuenow", "75");
  const zinc = within(section).getByRole("article", { name: "ZINC insights" });
  expect(within(zinc).getByText("Appears once daily history has loaded.")).toBeInTheDocument();
  expect(within(zinc).getByText("Lot details are not listed for this contract.")).toBeInTheDocument();
});
