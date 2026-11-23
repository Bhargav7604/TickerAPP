import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createChart } from "lightweight-charts";
import StraddleView from "./straddleView";
import { makeRows, makeStraddlePayload } from "../straddleFixtures";

jest.mock("lightweight-charts", () => ({ createChart: jest.fn(), LineSeries: "line", ColorType: { Solid: "solid" } }));

let lines;
beforeEach(() => {
  jest.useFakeTimers("modern");
  jest.setSystemTime(new Date("2026-11-23T14:20:30+05:30"));
  localStorage.clear();
  lines = [];
  createChart.mockImplementation(() => ({
    addSeries: (type, options) => {
      const line = { options, setData: jest.fn(), applyOptions: jest.fn(), createPriceLine: jest.fn(price => ({ price })), removePriceLine: jest.fn() };
      lines.push(line);
      return line;
    },
    timeScale: () => ({ fitContent: jest.fn() }), subscribeCrosshairMove: jest.fn(), remove: jest.fn(),
  }));
});
afterEach(() => { jest.useRealTimers(); });

function makeApi(payloads) {
  const queue = [...payloads];
  return {
    expiries: jest.fn(async () => ({ type: "success", expiries: ["2026-11-24", "2026-12-01"], recorded: ["2026-11-24"] })),
    load: jest.fn(async () => (queue.length > 1 ? queue.shift() : queue[0])),
  };
}
async function renderView(api) {
  await act(async () => { render(<StraddleView api={api} />); });
  await act(async () => { jest.advanceTimersByTime(0); });
  return api;
}
const rowText = key => [...document.querySelector(`tr[data-line="${key}"]`).querySelectorAll("td")].map(cell => cell.textContent);
const visibility = () => lines.map(line => line.applyOptions.mock.calls.at(-1)?.[0].visible);

test("loads the nearest recorded expiry and shows spot, ATM, the straddle and the ladder", async () => {
  const payload = makeStraddlePayload({ points: 100 });
  const api = await renderView(makeApi([payload]));
  expect(api.expiries).toHaveBeenCalledWith("nifty", expect.anything());
  expect(api.load).toHaveBeenCalledWith("nifty", "2026-11-24", "", expect.anything());
  const summary = within(screen.getByRole("region", { name: "Straddle summary" }));
  const atm = payload.current.rows.find(row => row.key === "ATM");
  expect(summary.getByText("ATM strike").nextSibling).toHaveTextContent(payload.current.atm.toLocaleString("en-IN"));
  expect(screen.getByTestId("straddle-price")).toHaveTextContent(atm.total.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  expect(summary.getByText(/since 09:18/)).toHaveTextContent(/^▼ −[\d.]+ \(−[\d.]+%\)/);   // the straddle has decayed since the open
  expect(summary.getByText("LIVE")).toBeInTheDocument();
  expect(rowText("ATM")[0]).toBe("ATM");
  expect(document.querySelector('tr[aria-current="true"]').dataset.line).toBe("ATM");
  const otm2 = payload.current.rows.find(row => row.key === "OTM2");
  expect(rowText("OTM2").slice(1, 4)).toEqual([otm2.ceStrike.toLocaleString("en-IN"), otm2.ce.toFixed(2), otm2.peStrike.toLocaleString("en-IN")]);
  expect(screen.getByRole("img", { name: /NIFTY straddle and strangle prices on .*100 points/ })).toBeInTheDocument();
});

test("line ticks show and hide lines and are remembered; the 15-minute view thins the points", async () => {
  await renderView(makeApi([makeStraddlePayload({ points: 100 })]));
  expect(visibility()).toEqual([true, true, true, true, false, false, false, false, true]);   // ATM, OTM 1-3 and ITM 1
  fireEvent.click(screen.getByRole("checkbox", { name: "OTM 7" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "OTM 1" }));
  expect(visibility()).toEqual([true, false, true, true, false, false, false, true, true]);
  expect(JSON.parse(localStorage.getItem("utraders-straddle")).lines).toEqual(["ATM", "OTM2", "OTM3", "ITM1", "OTM7"]);
  fireEvent.click(screen.getByRole("checkbox", { name: "All" }));
  expect(visibility().every(Boolean)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "15 min" }));
  expect(lines[0].setData.mock.calls.at(-1)[0].length).toBeLessThan(25);
  fireEvent.click(screen.getByRole("button", { name: "Table" }));
  expect(screen.queryByRole("img", { name: /straddle and strangle prices/ })).not.toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Straddle and strangle prices" })).toBeInTheDocument();
});

test("an alert fires once when the live straddle crosses its level, with a line on the chart", async () => {
  const first = makeStraddlePayload({ points: 100 });
  const atm = first.current.rows.find(row => row.key === "ATM").total;
  const lower = { ...first, current: { ...first.current, at: first.current.at + 5, rows: makeRows(first.current.atm, atm - 10) } };
  const api = await renderView(makeApi([first, lower]));
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Alert direction" }));
  fireEvent.click(await screen.findByRole("option", { name: "below" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Alert level" }), { target: { value: String(Math.round(atm - 5)) } });
  fireEvent.click(screen.getByRole("button", { name: "Set alert" }));
  expect(screen.getByText(`Watching for below ${Math.round(atm - 5).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`)).toBeInTheDocument();
  expect(lines[0].createPriceLine).toHaveBeenCalledWith(expect.objectContaining({ price: Math.round(atm - 5), title: "Alert" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  await act(async () => { jest.advanceTimersByTime(5000); });
  expect(api.load).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("alert")).toHaveTextContent(/NIFTY straddle .* went below .* IST\./);
  expect(screen.getByRole("button", { name: "Set alert" })).toBeInTheDocument();   // disarmed after firing
  expect(lines[0].removePriceLine).toHaveBeenCalled();
});

test("recorded days list past sessions and a failed load says why", async () => {
  const api = makeApi([{ ...makeStraddlePayload({ points: 20, live: false }) }]);
  await renderView(api);
  expect(screen.getByText("RECORDED")).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Straddle day" }));
  fireEvent.click(await screen.findByRole("option", { name: /20 Nov 2026/ }));
  await act(async () => { jest.advanceTimersByTime(0); });
  expect(api.load).toHaveBeenLastCalledWith("nifty", "2026-11-24", "2026-11-20", expect.anything());

  const failing = { expiries: jest.fn(async () => ({ type: "success", expiries: ["2026-11-24"], recorded: [] })), load: jest.fn(async () => { throw new Error("Select a valid expiry."); }) };
  document.body.innerHTML = "";
  await renderView(failing);
  expect(screen.getByRole("alert")).toHaveTextContent("Select a valid expiry.");
});
