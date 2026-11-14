import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import MarketPage, { globalQuotesUrl, squarify } from "./marketPage";
import StockFno from "./stockFno";
import { makeBoardPreviewApi, makeBoardSnapshot } from "../boardFixtures";

jest.mock("lightweight-charts", () => ({ createChart: jest.fn(), CandlestickSeries: "candles", ColorType: { Solid: "solid" } }));
const { createChart } = require("lightweight-charts");

beforeEach(() => {
  createChart.mockImplementation(() => ({ addSeries: () => ({ setData: jest.fn(), update: jest.fn(), applyOptions: jest.fn() }),
    applyOptions: jest.fn(), timeScale: () => ({ setVisibleLogicalRange: jest.fn() }), remove: jest.fn() }));
  jest.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(600);
  jest.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(360);
  sessionStorage.clear();
  window.history.replaceState(null, "", "/#market");
});
afterEach(() => jest.restoreAllMocks());

async function renderMarket() {
  const api = makeBoardPreviewApi();
  api.snapshot = jest.fn(api.snapshot);
  render(<MarketPage api={api} />);
  await screen.findByRole("article", { name: "NIFTY 50" });
  return api;
}

test("squarify fills the box with areas in proportion", () => {
  const tiles = squarify([{ v: 600 }, { v: 300 }, { v: 100 }], 0, 0, 40, 25);
  expect(tiles.reduce((sum, t) => sum + t.w * t.h, 0)).toBeCloseTo(1000);
  expect(tiles[0].w * tiles[0].h).toBeCloseTo(600);
});

test("index cards, mood, global cues, heatmaps, movers and breadth", async () => {
  await renderMarket();
  expect(screen.getByRole("heading", { name: "Market" })).toBeInTheDocument();
  expect(screen.getByText("LIVE")).toBeInTheDocument();
  ["SENSEX", "BANK NIFTY", "INDIA VIX"].forEach(name => expect(screen.getByRole("article", { name })).toBeInTheDocument());
  expect(within(screen.getByRole("article", { name: "INDIA VIX" })).getByText("Normal volatility")).toBeInTheDocument();
  const mood = screen.getByRole("region", { name: "Market mood" });
  ["Breadth", "India VIX", "Nifty PCR", "Sector money"].forEach(part => expect(within(mood).getByText(part)).toBeInTheDocument());
  expect(screen.getByTitle("Global markets from TradingView").getAttribute("src")).toMatch(/^https:\/\/s\.tradingview\.com\/embed-widget\/market-quotes\//);
  expect(decodeURIComponent(globalQuotesUrl("dark"))).toContain('"colorTheme":"dark"');
  expect(within(screen.getByRole("region", { name: "Sector heatmap" })).getByText("IT")).toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "Nifty 50 heatmap" })).getByText("HDFCBANK")).toBeInTheDocument();
  const movers = screen.getByRole("region", { name: "Market movers" });
  const gainers = within(movers).getByRole("table", { name: "Gainers" });
  expect(within(gainers).getAllByRole("row")).toHaveLength(13);
  fireEvent.click(within(movers).getByRole("button", { name: "52W high" }));
  expect(within(within(movers).getByRole("table", { name: "52W high" })).getByText("INFY")).toBeInTheDocument();
  fireEvent.click(within(movers).getByRole("button", { name: "Upper circuit" }));
  fireEvent.click(within(movers).getByRole("button", { name: "F&O only" }));
  expect(within(movers).getByText("No cash stock near its circuit limit right now.")).toBeInTheDocument();
  const breadth = screen.getByRole("region", { name: "Breadth by group" });
  expect(within(breadth).getByText("Sensex 30")).toBeInTheDocument();
});

test("a sector tile traces its money on the Money Flow page", async () => {
  await renderMarket();
  fireEvent.click(within(screen.getByRole("region", { name: "Sector heatmap" })).getByText("Realty").closest("button"));
  expect(sessionStorage.getItem("utraders-flow-sector")).toBe("Realty");
  expect(window.location.hash).toBe("#money-flow");
});

test("searching or clicking a stock opens its card", async () => {
  await renderMarket();
  fireEvent.click(within(screen.getByRole("group", { name: "Nifty 50 heatmap" })).getByText("ICICIBANK").closest("button"));
  const card = await screen.findByRole("presentation");
  expect(within(card).getByRole("heading", { name: "ICICIBANK" })).toBeInTheDocument();
  expect(within(card).getByText("Board conditions")).toBeInTheDocument();
  fireEvent.click(within(card).getByRole("button", { name: "Close stock card" }));
  const search = screen.getByRole("combobox", { name: "Search stock" });
  fireEvent.change(search, { target: { value: "INF" } });
  fireEvent.click(await screen.findByRole("option", { name: /INFY/ }));
  expect(await screen.findByRole("heading", { name: "INFY" })).toBeInTheDocument();
});

test("Stock F&O sorts futures into build-up boxes and lists expiries and lots", async () => {
  const api = makeBoardPreviewApi();
  render(<StockFno api={api} />);
  const longs = await screen.findByRole("region", { name: "Long build-up" });
  const data = makeBoardSnapshot();
  const fields = data.fields;
  const futures = data.rows.map(row => Object.fromEntries(fields.map((f, i) => [f, row[i]]))).filter(r => r.flags & 2);
  const count = futures.filter(r => r.ltp >= r.prev && r.oi >= r.prevOi).length;
  expect(await within(longs).findByText(String(count))).toBeInTheDocument();
  ["Short covering", "Short build-up", "Long unwinding"].forEach(name => expect(screen.getByRole("region", { name })).toBeInTheDocument());
  const table = screen.getByRole("table", { name: "Index expiries and lot sizes" });
  const nifty = within(table).getByText("NIFTY").closest("[role=row]");
  expect(within(nifty).getByText("Weekly")).toBeInTheDocument();
  expect(within(nifty).getByText("65")).toBeInTheDocument();
  await act(async () => { fireEvent.click(within(longs).getAllByRole("button")[0]); });
  expect(await screen.findByRole("button", { name: "Close stock card" })).toBeInTheDocument();
});
