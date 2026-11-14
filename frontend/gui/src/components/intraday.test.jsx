import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createChart } from "lightweight-charts";
import Intraday from "./intraday";
import { makeBoardSnapshot, makeScanner } from "../boardFixtures";

jest.mock("lightweight-charts", () => ({ createChart: jest.fn(), LineSeries: "line", HistogramSeries: "histogram", ColorType: { Solid: "solid" } }));
// The project's Jest config resets mocks before every test, so the chart stub is rebuilt here.
beforeEach(() => {
  localStorage.clear();
  createChart.mockImplementation(() => ({ addSeries: () => ({ setData: jest.fn(), applyOptions: jest.fn(), update: jest.fn() }),
    timeScale: () => ({ fitContent: jest.fn(), setVisibleLogicalRange: jest.fn() }), applyOptions: jest.fn(), subscribeCrosshairMove: jest.fn(), remove: jest.fn() }));
});

function makeApi(overrides = {}) {
  const snapshot = { ...makeBoardSnapshot(), ...overrides };
  return {
    snapshot: jest.fn(async () => snapshot),
    scanner: jest.fn(async bars => makeScanner(bars, snapshot)),
    candles: jest.fn(async () => ({ candles: [], message: "" })),
  };
}

async function renderPage(api = makeApi()) {
  let view;
  await act(async () => { view = render(<Intraday api={api} />); });
  return { api, ...view };
}

test("the clock shows every session zone and the index level cards use yesterday's range", async () => {
  const { container } = await renderPage();
  expect(screen.getByRole("heading", { level: 1, name: "Intraday" })).toBeInTheDocument();
  expect(container.querySelectorAll("[data-zone]")).toHaveLength(6);
  ["Opening range forms", "Trend window", "Lunch chop", "Europe opens · second move", "No fresh entries", "Square-off 15:15–15:30"]
    .forEach(label => expect(screen.getByText(label)).toBeInTheDocument());
  const nifty = screen.getByRole("region", { name: "NIFTY 50" });
  // prevH 24120, prevL 23860, prevC 23980 -> pivot 23,986.7, R1 24,113.3, S1 23,853.3
  expect(within(nifty).getByText("23,986.7")).toBeInTheDocument();
  expect(within(nifty).getByText("24,113.3")).toBeInTheDocument();
  expect(within(nifty).getByText("23,853.3")).toBeInTheDocument();
  expect(within(nifty).getByText(/^CPR width \d+\.\d\d%/)).toBeInTheDocument();
  expect(within(nifty).getByText(/Camarilla H3/)).toBeInTheDocument();
  expect(within(nifty).getByText(/CPR|R1|S1/, { selector: "p" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "BANK NIFTY" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "SENSEX" })).toBeInTheDocument();
});

test("missing previous-day levels say when they will appear", async () => {
  const base = makeBoardSnapshot();
  await renderPage(makeApi({ indices: base.indices.map(ix => ix.key === "SENSEX" ? { ...ix, prevH: null, prevL: null, prevC: null } : ix) }));
  expect(within(screen.getByRole("region", { name: "SENSEX" })).getByText("Levels appear after the daily stats load.")).toBeInTheDocument();
});

test("the scanner lists setups, refetches on a new bar size and remembers its settings", async () => {
  const { api } = await renderPage();
  expect(api.scanner).toHaveBeenCalledWith(3, expect.anything());
  const table = screen.getByRole("table", { name: "Intraday setups" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows.length).toBeGreaterThan(0);
  expect(within(rows[0]).getByText(/▲ LONG|▼ SHORT/)).toBeInTheDocument();
  expect(rows[0].querySelectorAll("i")).toHaveLength(13);
  expect(screen.getByText(/\d+ long · \d+ short setups · 3-min bars · All \(NIFTY 500 \+ F&O\)/)).toBeInTheDocument();
  expect(table.querySelectorAll('[data-setup="short"]').length).toBeGreaterThan(0);

  await act(async () => { fireEvent.change(screen.getByLabelText("Side"), { target: { value: "long" } }); });
  expect(table.querySelectorAll('[data-setup="short"]')).toHaveLength(0);
  expect(table.querySelectorAll('[data-setup="long"]').length).toBeGreaterThan(0);

  await act(async () => { fireEvent.change(screen.getByLabelText("Bars"), { target: { value: "5" } }); });
  expect(api.scanner).toHaveBeenLastCalledWith(5, expect.anything());
  expect(screen.getByText(/5-min bars/)).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("utraders-scanner"))).toEqual({ side: "long", minPct: 80, bars: 5, volume: false, liquidOnly: true });
});

test("a stricter agreement level never shows more setups", async () => {
  await renderPage();
  await act(async () => { fireEvent.change(screen.getByLabelText("Indicators agreeing ≥"), { target: { value: "60" } }); });
  const loose = screen.getAllByRole("row").length;
  await act(async () => { fireEvent.change(screen.getByLabelText("Indicators agreeing ≥"), { target: { value: "90" } }); });
  const strict = screen.queryAllByRole("row").length;
  expect(strict).toBeLessThanOrEqual(loose);
});

test("early-session warning and the waiting message before the scanner starts", async () => {
  const api = makeApi({ minute: 8 });
  api.scanner.mockResolvedValue({ type: "success", rows: [], bars: 3, message: "The scanner starts a minute after market data arrives." });
  await renderPage(api);
  expect(screen.getByText("Opening range still forming (till 09:30) — signals are early.")).toBeInTheDocument();
  expect(screen.getByText("The scanner starts a minute after market data arrives.")).toBeInTheDocument();
});
