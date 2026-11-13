import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createChart } from "lightweight-charts";
import LiveDashboard, { moveChart } from "./liveDashboard";
import { applyTick } from "./liveChart";
import { DEFAULT_ORDER } from "../dashboardData";

jest.mock("lightweight-charts", () => ({ createChart: jest.fn(), CandlestickSeries: "candlestick", ColorType: { Solid: "solid" } }));

let series;
beforeEach(() => {
  localStorage.clear();
  series = [];
  createChart.mockImplementation(() => ({
    addSeries: () => { const item = { setData: jest.fn(), update: jest.fn(), applyOptions: jest.fn() }; series.push(item); return item; },
    applyOptions: jest.fn(), remove: jest.fn(), timeScale: () => ({ setVisibleLogicalRange: jest.fn() }),
  }));
});

const T = 1794556500;  // a 5-minute boundary
const quote = (id, symbol, exchange, ltp, change, changePct) => ({ id, symbol, exchange, ltp, change, changePct, tradedAt: T + 61 });
function makeApi() {
  return {
    quotes: jest.fn(async () => ({ type: "success", message: "", charts: [
      quote("nifty-fut", "NIFTY26NOVFUT", "NFO", 25161.4, -147.3, -0.58), quote("banknifty", "NIFTY BANK", "NSE", 60967.75, -550.75, -0.9),
      quote("india-vix", "INDIA VIX", "NSE", 16, -0.62, -3.73), quote("crude-oil", "CRUDEOIL26NOVFUT", "MCX", 8388, 88, 1.06),
      quote("usd-inr", "USDINR26NOVFUT", "CDS", 94.345, 0.2225, 0.24)] })),
    candles: jest.fn(async () => ({ type: "success", candles: [{ time: T, open: 100, high: 101, low: 99, close: 100.5 }], message: "" })),
  };
}
async function setup(api = makeApi()) {
  await act(async () => { render(<LiveDashboard api={api} />); });
  return api;
}
const shownOrder = () => screen.getAllByRole("region").map(region => region.getAttribute("aria-label"));

test("six live charts in the default order, with prices and changes", async () => {
  const api = await setup();
  expect(shownOrder()).toEqual(["Dow Futures", "Nifty 50 Futures", "Bank Nifty", "India VIX", "Crude Oil", "USD / INR"]);
  const crude = screen.getByRole("region", { name: "Crude Oil" });
  expect(crude).toHaveTextContent("MCX:CRUDEOIL26NOVFUT");
  expect(crude).toHaveTextContent("8,388.00");
  expect(crude).toHaveTextContent("+88.00 (+1.06%)");
  expect(screen.getByRole("region", { name: "USD / INR" })).toHaveTextContent("94.3450");
  expect(within(screen.getByRole("region", { name: "Dow Futures" })).getByTitle("Dow futures chart (US30) from TradingView").getAttribute("src"))
    .toContain("symbol=CAPITALCOM%3AUS30");
  expect(api.candles).toHaveBeenCalledTimes(5);
  expect(api.candles).toHaveBeenCalledWith("crude-oil", "5minute", expect.anything());
  expect(screen.getByRole("button", { name: "Move Crude Oil" })).toBeInTheDocument();
});

test("each chart's candle size can change and is remembered", async () => {
  const api = await setup();
  const crude = screen.getByRole("region", { name: "Crude Oil" });
  await act(async () => { fireEvent.click(within(crude).getByRole("button", { name: "15m" })); });
  expect(api.candles).toHaveBeenLastCalledWith("crude-oil", "15minute", expect.anything());
  expect(JSON.parse(localStorage.getItem("utraders-dashboard-intervals"))).toEqual({ "crude-oil": "15minute" });
});

test("a saved order is used, and Reset order goes back to the default", async () => {
  localStorage.setItem("utraders-dashboard-order", JSON.stringify(["usd-inr", "crude-oil", "gold", "usd-inr"]));
  await setup();
  expect(shownOrder()).toEqual(["USD / INR", "Crude Oil", "Dow Futures", "Nifty 50 Futures", "Bank Nifty", "India VIX"]);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Reset order" })); });
  expect(shownOrder()).toEqual(["Dow Futures", "Nifty 50 Futures", "Bank Nifty", "India VIX", "Crude Oil", "USD / INR"]);
  expect(JSON.parse(localStorage.getItem("utraders-dashboard-order"))).toEqual(DEFAULT_ORDER);
  expect(screen.getByRole("button", { name: "Reset order" })).toBeDisabled();
});

test("dropping a chart on another takes its place", () => {
  expect(moveChart(DEFAULT_ORDER, "crude-oil", "dow")).toEqual(["crude-oil", "dow", "nifty-fut", "banknifty", "india-vix", "usd-inr"]);
  expect(moveChart(DEFAULT_ORDER, "dow", "usd-inr")).toEqual(["nifty-fut", "banknifty", "india-vix", "crude-oil", "usd-inr", "dow"]);
  expect(moveChart(DEFAULT_ORDER, "dow", null)).toBe(DEFAULT_ORDER);
});

test("live prices grow the current candle or start the next one", () => {
  const candles = [{ time: T, open: 100, high: 101, low: 99, close: 100.5 }];
  expect(applyTick(candles, 102, T + 120, "5minute")).toEqual({ time: T, open: 100, high: 102, low: 99, close: 102 });
  expect(applyTick(candles, 98, T + 299, "5minute")).toEqual({ time: T, open: 100, high: 101, low: 98, close: 98 });
  expect(applyTick(candles, 99.5, T + 610, "5minute")).toEqual({ time: T + 600, open: 99.5, high: 99.5, low: 99.5, close: 99.5 });
  expect(applyTick(candles, 99.5, T - 1, "5minute")).toBeNull();
  expect(applyTick([], 99.5, T, "5minute")).toBeNull();
});

test("the live price is applied to the chart", async () => {
  await setup();
  expect(series.length).toBe(5);
  expect(series.some(item => item.update.mock.calls.some(([bar]) => bar.close === 8388))).toBe(true);
});
