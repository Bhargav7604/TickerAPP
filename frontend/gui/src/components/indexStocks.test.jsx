import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import IndexStocks from "./indexStocks";

const stock = (symbol, changePct, overrides = {}) => ({
  symbol, company: symbol, sector: "Private Banks", ltp: 1000 + changePct * 10, prevClose: 1000, change: changePct * 10, changePct,
  open: 1000, high: 1030, low: 980, vwap: 1002, vsVwapPct: changePct > 0 ? 0.5 : -0.4, rangePos: 0.6, volume: 120000,
  futures: { symbol: `${symbol}26NOVFUT`, ltp: 1005, oi: 1100, oiChange: 100, oiChangePct: 10, buildup: changePct > 0 ? "Long Build-up" : "Short Build-up", code: changePct > 0 ? "LB" : "SB" },
  pivots: { s2: 970.67, s1: 985.33, p: 994.67, r1: 1009.33, r2: 1018.67, prevHigh: 1004, prevLow: 980 },
  checks: [{ name: "Change", side: changePct > 0 ? "bull" : "bear" }, { name: "VWAP", side: changePct > 0 ? "bull" : "bear" },
           { name: "Open", side: "bull" }, { name: "Futures OI", side: changePct > 0 ? "bull" : "bear", text: changePct > 0 ? "Long Build-up" : "Short Build-up" }],
  bull: changePct > 0 ? 4 : 1, bear: changePct > 0 ? 0 : 3, score: changePct > 0 ? 4 : -2, state: changePct > 0 ? "bullish" : "bearish", ...overrides,
});

function payload(overrides = {}) {
  const stocks = [stock("HDFCBANK", 1.2), stock("ICICIBANK", 0.8), stock("AXISBANK", 0.3, { state: "choppy", bull: 2, score: 1 }),
    stock("PNB", 0, { sector: "PSU Banks", state: "choppy" }), stock("SBIN", -0.9, { sector: "PSU Banks" }), stock("CANBK", -1.6, { sector: "PSU Banks", pivots: null })]
    .map((row, index) => ({ ...row, rank: index + 1 }));
  return {
    type: "success", index: "banknifty", label: "BANK NIFTY", marketOpen: true, stocks,
    spot: { ltp: 56500, change: 312.4, changePct: 0.56 }, asOf: 1793600000, sessionDate: "2026-11-02",
    breadth: { up: 3, down: 2, flat: 1, bullish: 2, bearish: 2, choppy: 2, mood: "More stocks rising", moodSide: "up", avgChangePct: -0.03 },
    sectors: [
      { name: "Private Banks", avgChangePct: 0.77, up: 3, down: 0, stocks: [{ symbol: "HDFCBANK", changePct: 1.2 }, { symbol: "ICICIBANK", changePct: 0.8 }, { symbol: "AXISBANK", changePct: 0.3 }] },
      { name: "PSU Banks", avgChangePct: -0.83, up: 0, down: 2, stocks: [{ symbol: "PNB", changePct: 0 }, { symbol: "SBIN", changePct: -0.9 }, { symbol: "CANBK", changePct: -1.6 }] },
    ],
    leading: { name: "Private Banks", avgChangePct: 0.77 }, lagging: { name: "PSU Banks", avgChangePct: -0.83 },
    missing: [], levelsReady: 5, retryAfterMs: null, message: "", ...overrides,
  };
}

async function setup(load = jest.fn(async () => payload())) {
  localStorage.setItem("utraders-index-stocks", "banknifty");
  await act(async () => { render(<IndexStocks api={{ load }} />); });
  return load;
}

beforeEach(() => { localStorage.clear(); jest.useRealTimers(); });

test("shows breadth, the gauge and both tables for the chosen index", async () => {
  const load = await setup();
  expect(load).toHaveBeenCalledWith("banknifty", expect.anything());
  expect(screen.getByRole("tab", { name: "BANK NIFTY" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("56,500.00")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "3 up, 2 down, 1 unchanged" })).toBeInTheDocument();
  expect(screen.getByText("More stocks rising")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Advance and decline: 3 of 6 stocks up, 2 down, 1 unchanged" })).toBeInTheDocument();
  expect(screen.getByText("50% of stocks are up")).toBeInTheDocument();
  const gauge = screen.getByRole("region", { name: "Market breadth" });
  expect(within(gauge).getAllByRole("button", { name: /%$/ }).map(button => button.querySelector("b").textContent))
    .toEqual(["HDFCBANK", "ICICIBANK", "AXISBANK", "CANBK", "SBIN"]);

  const gainers = screen.getByRole("region", { name: "Gainers" });
  expect(within(gainers).getAllByRole("row")).toHaveLength(4);
  expect(within(gainers).getAllByText("LB")).toHaveLength(3);
  const losers = screen.getByRole("region", { name: "Losers" });
  expect(within(losers).getAllByRole("rowheader").map(cell => cell.querySelector("button").textContent)).toEqual(["CANBK", "SBIN"]);
  expect(within(losers).getAllByLabelText("3 of 4 checks agree")).toHaveLength(2);
  expect(screen.getByText("No change: PNB")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Sector flow" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Top movers" })).not.toBeInTheDocument();
  expect(screen.getByText(/ready for 5 of 6 stocks/)).toBeInTheDocument();
});

test("a row opens the stock's levels, futures and checks", async () => {
  await setup();
  const gainers = screen.getByRole("region", { name: "Gainers" });
  fireEvent.click(within(gainers).getByRole("button", { name: "HDFCBANK" }));
  expect(within(gainers).getByRole("button", { name: "HDFCBANK" })).toHaveAttribute("aria-expanded", "true");
  expect(within(gainers).getByText("1,009.33")).toBeInTheDocument();
  expect(within(gainers).getByText("Futures: price up and OI up, new buyers coming in")).toBeInTheDocument();
  expect(within(gainers).getByText("Above today's average price (VWAP)")).toBeInTheDocument();
  fireEvent.click(within(gainers).getByRole("button", { name: "HDFCBANK" }));
  expect(within(gainers).queryByText("1,009.33")).not.toBeInTheDocument();

  const losers = screen.getByRole("region", { name: "Losers" });
  fireEvent.click(within(losers).getByRole("button", { name: "CANBK" }));
  expect(within(losers).getByText("Levels load after the morning history update.")).toBeInTheDocument();
});

test("switching index reloads and remembers the choice", async () => {
  const load = await setup();
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "SENSEX" })); });
  expect(load).toHaveBeenLastCalledWith("sensex", expect.anything());
  expect(localStorage.getItem("utraders-index-stocks")).toBe("sensex");
});

test("explains when prices are not available", async () => {
  await setup(jest.fn(async () => payload({ stocks: [], sectors: [], breadth: undefined, message: "Live prices are not connected. Please try again in a few minutes." })));
  expect(screen.getByText(/Live prices are not connected/)).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Gainers" })).not.toBeInTheDocument();
});

test("shows the error from a failed load", async () => {
  await setup(jest.fn(async () => { throw new Error("Stock prices are unavailable right now."); }));
  expect(screen.getByRole("alert")).toHaveTextContent("Stock prices are unavailable right now.");
});

test("the breadth chart switches between gauge, movers and sectors and remembers the choice", async () => {
  await setup();
  const chart = screen.getByRole("region", { name: "Market breadth" });
  fireEvent.click(within(chart).getByRole("button", { name: "Movers" }));
  expect(within(chart).getByRole("button", { name: "Movers" })).toHaveAttribute("aria-pressed", "true");
  expect(within(chart).getAllByRole("button", { name: /open the stock$/ }).map(button => button.getAttribute("aria-label")))
    .toEqual(["HDFCBANK +1.20%, open the stock", "ICICIBANK +0.80%, open the stock", "AXISBANK +0.30%, open the stock",
      "PNB 0.00%, open the stock", "SBIN -0.90%, open the stock", "CANBK -1.60%, open the stock"]);
  expect(localStorage.getItem("utraders-breadth-chart")).toBe("movers");

  fireEvent.click(within(chart).getByRole("button", { name: "SBIN -0.90%, open the stock" }));
  const losers = screen.getByRole("region", { name: "Losers" });
  expect(within(losers).getByRole("button", { name: "SBIN" })).toHaveAttribute("aria-expanded", "true");

  fireEvent.click(within(chart).getByRole("button", { name: "Sectors" }));
  expect(within(chart).getByText("Private Banks", { selector: ".ix-bar-name" })).toBeInTheDocument();
  expect(within(chart).getByText("0↑ 2↓")).toBeInTheDocument();
  expect(within(chart).queryByRole("button", { name: /open the stock$/ })).not.toBeInTheDocument();
});
