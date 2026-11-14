import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createChart } from "lightweight-charts";
import Tools, { blackScholes, charges, num, positionSize } from "./tools";
import { makeBoardSnapshot, makeScanner } from "../boardFixtures";

jest.mock("lightweight-charts", () => ({ createChart: jest.fn(), LineSeries: "line", HistogramSeries: "histogram", ColorType: { Solid: "solid" } }));
// The project's Jest config resets mocks before every test, so the chart stub is rebuilt here.
beforeEach(() => {
  localStorage.clear();
  createChart.mockImplementation(() => ({ addSeries: () => ({ setData: jest.fn(), applyOptions: jest.fn(), update: jest.fn() }),
    timeScale: () => ({ fitContent: jest.fn(), setVisibleLogicalRange: jest.fn() }), applyOptions: jest.fn(), subscribeCrosshairMove: jest.fn(), remove: jest.fn() }));
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-14T10:00:00+05:30"));
});
afterEach(() => jest.restoreAllMocks());

function makeApi() {
  const snapshot = makeBoardSnapshot();
  return { snapshot: jest.fn(async () => snapshot), scanner: jest.fn(async bars => makeScanner(bars, snapshot)),
    candles: jest.fn(async () => ({ candles: [], message: "" })) };
}

async function renderPage(api = makeApi()) {
  let view;
  await act(async () => { view = render(<Tools api={api} />); });
  return { api, ...view };
}
const result = (container, name) => container.querySelector(`[data-result="${name}"]`)?.textContent;
const rupees = text => Number(text.replace(/[₹,]/g, ""));

test("calculators match the file's formulas", () => {
  expect(num("5,00,000")).toBe(500000);
  expect(num("abc")).toBe(0);
  const size = positionSize({ capital: 500000, riskPct: 1, entry: 1400, stop: 1386, lot: 1 });
  expect([size.qty, size.maxLoss, size.target2]).toEqual([357, 357 * 14, 1428]);
  expect(positionSize({ capital: 500000, riskPct: 1, entry: 1400, stop: 1400, lot: 1 })).toBeNull();
  const cost = charges({ buy: 1000, sell: 1010, qty: 100, brokerage: 20, sttBuy: 0, sttSell: 0.025, exch: 0.00297, stamp: 0.003, sebi: 10, gst: 18 });
  expect(cost.turnover).toBe(201000);
  expect(cost.stt).toBeCloseTo(25.25);
  expect(cost.net).toBeCloseTo(1000 - cost.total);
  expect(blackScholes(24000, 24000, 0, 0.13, "C")).toBe(0);
  expect(blackScholes(24100, 24000, 0, 0.13, "C")).toBe(100);
});

test("position size, charges and pivots render from the inputs", async () => {
  const { container } = await renderPage();
  expect(screen.getByRole("heading", { level: 1, name: "Tools" })).toBeInTheDocument();
  expect(result(container, "Quantity")).toBe("357");
  expect(result(container, "Max loss at stop")).toBe("₹4,998.00");
  expect(result(container, "Target 1 : 2")).toMatch(/^1,428\.0/);
  fireEvent.change(screen.getByLabelText("Stop-loss"), { target: { value: "1,390" } });
  expect(result(container, "Quantity")).toBe("500");

  const intraday = rupees(result(container, "Total charges"));
  expect(intraday).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText("Segment"), { target: { value: "opt" } });
  expect(screen.getByLabelText("STT sell %")).toHaveValue("0.15");
  expect(rupees(result(container, "Total charges"))).not.toBe(intraday);

  const pivots = container.querySelector('[data-results="Classic pivots"]');
  expect(within(pivots).getByText("23,986.7")).toBeInTheDocument();
  expect(within(container.querySelector('[data-results="Central pivot range"]')).getByText(/%$/)).toBeInTheDocument();
});

test("option prices are filled from NIFTY and break-evens sit a premium away from the strike", async () => {
  const { container } = await renderPage();
  expect(screen.getByLabelText("Spot")).toHaveValue("23980.45");
  expect(screen.getByLabelText("Strike")).toHaveValue("24000");
  expect(screen.getByLabelText("Days to expiry")).toHaveValue("4");
  const call = rupees(result(container, "Call (CE) fair value"));
  const put = rupees(result(container, "Put (PE) fair value"));
  expect(call).toBeGreaterThan(0);
  expect(put).toBeGreaterThan(0);
  expect(Number(result(container, "CE break-even").replace(/,/g, ""))).toBeCloseTo(24000 + call, 0);
  expect(Number(result(container, "PE break-even").replace(/,/g, ""))).toBeCloseTo(24000 - put, 0);
  expect(Number(result(container, "Call delta"))).toBeGreaterThan(0);
  expect(Number(result(container, "Put delta"))).toBeLessThan(0);
});

test("the calendar lists each index's expiries and upcoming holidays", async () => {
  const { container } = await renderPage();
  const nifty = container.querySelector('[data-index="NIFTY"]');
  expect(within(nifty).getByText("Weekly · lot 65")).toBeInTheDocument();
  expect(within(nifty).getByText("3d")).toBeInTheDocument();  // 17 Nov from 14 Nov
  expect(screen.getByText("Guru Nanak Jayanti")).toBeInTheDocument();
  expect(screen.getByText("Christmas")).toBeInTheDocument();
});

test("the watchlist adds known symbols, rejects others and remembers changes", async () => {
  await renderPage();
  const list = screen.getByRole("list", { name: "Watchlist" });
  expect(within(list).getAllByRole("listitem").map(row => row.dataset.sym)).toEqual(["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "SBIN"]);
  const input = screen.getByLabelText("Add symbol");
  fireEvent.change(input, { target: { value: "notreal" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getByText("NOTREAL is not in the NIFTY 500 or F&O list.")).toBeInTheDocument();
  fireEvent.change(input, { target: { value: "infy" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(screen.getByText("INFY is already in your watchlist.")).toBeInTheDocument();
  fireEvent.change(input, { target: { value: " wipro " } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(within(list).getByRole("button", { name: "WIPRO" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove SBIN" }));
  expect(JSON.parse(localStorage.getItem("utraders-board-watch"))).toEqual(["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "WIPRO"]);
});
