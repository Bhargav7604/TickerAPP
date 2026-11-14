import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createChart } from "lightweight-charts";
import OiAnalysis, { chainFlashes } from "./oiAnalysis";
import { compactOi } from "../oiData";

jest.mock("lightweight-charts", () => ({ createChart: jest.fn(), LineSeries: "line", HistogramSeries: "histogram", ColorType: { Solid: "solid" } }));
// The project's Jest config resets mocks before every test, so the chart stub is rebuilt here.
beforeEach(() => {
  localStorage.clear();
  createChart.mockImplementation(() => ({ addSeries: () => ({ setData: jest.fn() }), timeScale: () => ({ fitContent: jest.fn() }),
    subscribeCrosshairMove: jest.fn(), remove: jest.fn() }));
});

const T0 = Date.UTC(2026, 9, 22, 3, 45) / 1000;
const trendRow = (minutes, call, put, extra = {}) => ({ time: T0 + minutes * 60, underlying: 22600 + minutes, dayBreak: null,
  callOiChange: call, putOiChange: put, diff: put - call, strength: Math.round((put - call) / Math.max(call, put) * 100),
  changePcr: Number((put / call).toFixed(2)), oiPcr: 1.1, callLtp: 300, putLtp: 280, sentiment: put > call ? "Bullish" : "Bearish", ...extra });
const series = [trendRow(0, 1000, 800), trendRow(3, 2000, 3500, { dayBreak: { type: "DHB", level: 22600 }, diffChange: 1700 })];
const side = (oi, oiChange, ltpChange, buildup) => ({ oi, oiChange, oiChangeWindow: oiChange / 10, buildupWindow: buildup, oiChangePct: 5, ltp: 120,
  ltpChange, ltpChangePct: 2, iv: 14.2, delta: 0.52, buildup, volume: 12500 });

function makeApi() {
  return {
    expiries: jest.fn(async () => ({ expiries: ["2026-10-27", "2026-11-03"], recorded: ["2026-10-27"], intervals: [3, 6, 15, 30, 60], strikeWindows: [5, 7, 10, 15] })),
    trend: jest.fn(async () => ({ rows: [...series].reverse(), series, strikes: [22550, 22600, 22650], atm: 22600, underlying: 22603, interval: 3, baseline: "previous close", message: "" })),
    chain: jest.fn(async () => chainData()),
    liveChain: jest.fn(async () => ({ ...chainData(), live: true, retryAfterMs: null })),
  };
}

function chainData() {
  return {
      rows: [
        { strike: 22550, call: side(500000, 20000, 5, "Long Build-up"), put: side(900000, -1000, -3, "Long Unwinding"), pcr: 1.8 },
        { strike: 22600, call: side(800000, 50000, -4, "Short Build-up"), put: side(700000, 30000, 6, "Long Build-up"), pcr: 0.88 },
      ],
      underlying: 22603, atm: 22600, bucketTime: T0, baseline: "previous close", window: 15, windowFrom: T0 - 900, marketOpen: true,
      expiry: "2026-10-27", range: "atm", totalStrikes: 165, maxPain: 22550, atmIv: 14.2,
      windowStatus: { ready: true, minutesRecorded: 15, snapshots: 40 }, windowTotals: { callOiChange: 7000, putOiChange: 2900 },
      totals: { callOi: 1300000, putOi: 1600000, callOiChange: 70000, putOiChange: 29000, pcr: 1.23 }, maxCallOiStrike: 22600, maxPutOiStrike: 22550, message: "" };
}

async function renderPage(api = makeApi()) {
  await act(async () => { render(<OiAnalysis api={api} />); });
  return api;
}

test("shows the live OI summary, chart and trending rows for the first recorded expiry", async () => {
  const api = await renderPage();
  expect(api.trend).toHaveBeenCalledWith("nifty", "2026-10-27", 3, 7, expect.anything());
  const summary = screen.getByRole("region", { name: "Latest OI summary" });
  expect(within(summary).getByText(compactOi(1500))).toBeInTheDocument();
  expect(within(summary).getByText("Bullish")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "OI change chart with 2 samples" })).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "Trending OI by time" });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(within(table).getByText("DHB 22,600.00")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /03 Nov 2026 \(no data yet\)/ })).toBeInTheDocument();
});

test("changing interval or index requests fresh data", async () => {
  const api = await renderPage();
  await act(async () => { fireEvent.change(screen.getByLabelText("Interval"), { target: { value: "15" } }); });
  expect(api.trend).toHaveBeenLastCalledWith("nifty", "2026-10-27", 15, 7, expect.anything());
  expect([...screen.getByLabelText("Symbol").options].map(option => option.textContent)).toEqual(["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "SENSEX"]);
  await act(async () => { fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "finnifty" } }); });
  expect(api.expiries).toHaveBeenLastCalledWith("finnifty", expect.anything());
});

test("option chain streams live quotes with build-up labels, ATM row and OI bars", async () => {
  const api = await renderPage();
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Option Chain" })); });
  expect(api.liveChain).toHaveBeenCalledWith("nifty", "2026-10-27", 15, "atm", expect.anything());
  expect(api.chain).not.toHaveBeenCalled();
  expect(screen.getByText("LIVE")).toBeInTheDocument();
  const table = screen.getByRole("table", { name: "Option chain with OI build-up" });
  expect(within(table).getByTitle("Short Build-up")).toHaveTextContent("SB");
  expect(within(table).getByText("ATM").closest("tr")).toHaveClass("is-atm");
  const headers = within(table).getAllByRole("columnheader").map(cell => cell.textContent);
  expect(headers).toEqual(["Calls", "Strike", "Puts", "Build-up 15m", "ΔOI 15m", "OI", "ΔOI day", "Vol", "IV", "LTP", "Δ",
    "Δ", "LTP", "IV", "Vol", "ΔOI day", "OI", "ΔOI 15m", "Build-up 15m"]);
  const atmCells = within(within(table).getByText("ATM").closest("tr")).getAllByRole("cell").map(cell => cell.textContent);
  expect(atmCells).toEqual(["SB", "+5,000", "8.0L", "+50,000", "12.5k", "14.2", "120.00", "0.52", "0.52", "120.00", "14.2", "12.5k", "+30,000", "7.0L", "+3,000", "LB"]);
  // Spot 22,603 sits above both strikes, so its marker row closes the table.
  const bodyRows = within(table).getAllByRole("row").slice(2);
  expect(bodyRows[bodyRows.length - 1]).toHaveTextContent("Spot 22,603.00");
  const summary = screen.getByRole("region", { name: "Option chain summary" });
  ["22,603.00", "22,600", "27 Oct 2026", "1.23", "22,550", "14.2%", "13.0L", "ΔDay +70.0k", "16.0L", "ΔDay +29.0k", "+7.0k / +2.9k"]
    .forEach(value => expect(within(summary).getByText(value)).toBeInTheDocument());
  expect(screen.getByText(/build-up window 15m is ready — 15 of 15 min recorded today \(40 snapshots\)/)).toBeInTheDocument();
  expect(screen.getByText(/showing 2 of 165 strikes/)).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Open interest by strike for 2 strikes" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "OI change today" }));
  expect(screen.getByRole("img", { name: "OI change by strike for 2 strikes" })).toBeInTheDocument();
  expect(screen.getByText("Support (max put OI)")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "OI %" }));
  const oiPct = screen.getByRole("img", { name: "OI change % by strike for 2 strikes" });
  expect(oiPct.querySelector("title")).toHaveTextContent(/: \+5%$/);
  expect(screen.getByText(/OI % = today's OI change/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "LTP %" }));
  const ltpPct = screen.getByRole("img", { name: "LTP change % by strike for 2 strikes" });
  expect(ltpPct.querySelector("title")).toHaveTextContent(/: \+2%$/);
  expect(screen.getByRole("button", { name: "LTP %" })).toHaveAttribute("aria-pressed", "true");
});

test("shows the recorder message when an expiry has no data", async () => {
  const api = makeApi();
  api.trend.mockResolvedValue({ rows: [], series: [], message: "No OI recorded yet for this expiry." });
  await renderPage(api);
  expect(screen.getByText("No OI recorded yet for this expiry.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});

test("falls back to the recorded chain when live quotes are unavailable", async () => {
  const api = makeApi();
  api.liveChain.mockResolvedValue({ rows: [], live: false, message: "Zerodha session is not connected." });
  await renderPage(api);
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Option Chain" })); });
  expect(api.chain).toHaveBeenCalledWith("nifty", "2026-10-27", 15, "atm", expect.anything());
  expect(screen.getByText(/Live quotes unavailable \(Zerodha session is not connected\.\)/)).toBeInTheDocument();
  expect(screen.queryByText("LIVE")).not.toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Option chain with OI build-up" })).toBeInTheDocument();
});

test("live ticks flash the cells whose LTP or OI moved", () => {
  const before = chainData();
  const after = chainData();
  after.rows[1].call = { ...after.rows[1].call, ltp: 125, oi: 790000 };
  expect(chainFlashes(before, after)).toEqual({ "22600:call:ltp": "up", "22600:call:oi": "down" });
  expect(chainFlashes(null, after)).toEqual({});
});

test("build-up window and strike range change the chain and are remembered", async () => {
  const api = await renderPage();
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Option Chain" })); });
  const windows = screen.getByRole("group", { name: "Build-up window" });
  expect(within(windows).getAllByRole("button").map(button => button.textContent)).toEqual(["3m", "6m", "15m", "30m", "1h"]);
  expect(within(windows).getByRole("button", { name: "15m" })).toHaveAttribute("aria-pressed", "true");
  api.liveChain.mockResolvedValue({ ...chainData(), window: 60, windowTotals: null, windowStatus: { ready: false, minutesRecorded: 21, snapshots: 8 }, live: true, retryAfterMs: null });
  await act(async () => { fireEvent.click(within(windows).getByRole("button", { name: "1h" })); });
  expect(api.liveChain).toHaveBeenLastCalledWith("nifty", "2026-10-27", 60, "atm", expect.anything());
  const table = screen.getByRole("table", { name: "Option chain with OI build-up" });
  expect(await within(table).findAllByText("ΔOI 1h")).toHaveLength(2);
  expect(within(table).getAllByText("Build-up 1h")).toHaveLength(2);
  expect(screen.getByText(/build-up window 1h is warming — 21 of 60 min recorded today \(8 snapshots\)/)).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Option chain summary" })).getByText("warming")).toBeInTheDocument();
  expect(localStorage.getItem("utraders-oi-change-window")).toBe("60");
  await act(async () => { fireEvent.click(within(screen.getByRole("group", { name: "Strikes shown" })).getByRole("button", { name: "Whole chain" })); });
  expect(api.liveChain).toHaveBeenLastCalledWith("nifty", "2026-10-27", 60, "all", expect.anything());
  expect(localStorage.getItem("utraders-oi-strike-range")).toBe("all");
});
