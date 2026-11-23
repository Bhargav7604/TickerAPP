import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import MarketHolidays from "./marketHolidays";

beforeEach(() => { jest.useFakeTimers("modern"); });
afterEach(() => { jest.useRealTimers(); });

function renderAt(text) {
  jest.setSystemTime(new Date(`${text}+05:30`));
  return render(<MarketHolidays />);
}
const exchangeLabels = () => within(screen.getByRole("list", { name: "Exchange status" })).getAllByRole("listitem").map(item => item.getAttribute("aria-label"));
const tableRows = () => within(screen.getByRole("table", { name: "2026 market holidays" })).getAllByRole("row").slice(1);

test("live status shows every exchange and updates as the clock passes the close", () => {
  renderAt("2026-11-23T15:29:59");
  expect(screen.getByRole("heading", { name: "Market Holidays" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Open now: NSE, BSE, NFO, BFO, MCX");
  expect(screen.getByRole("region", { name: "Live exchange status" })).toHaveTextContent("Mon 23 Nov 2026 · 15:29:59 IST");
  expect(exchangeLabels()).toEqual(["NSE: Open. Closes 15:30", "BSE: Open. Closes 15:30", "NFO: Open. Closes 15:30", "BFO: Open. Closes 15:30", "MCX: Open. Closes 23:55"]);

  act(() => { jest.advanceTimersByTime(1000); });
  expect(screen.getByRole("status")).toHaveTextContent("Open now: MCX");
  expect(exchangeLabels()[0]).toBe("NSE: Closed. After hours · Opens Wed 25 Nov, 09:15");
  expect(screen.getByRole("region", { name: "Live exchange status" })).toHaveTextContent("15:30:00 IST");
});

test("the next trading holiday shows what stays open and how many are left", () => {
  renderAt("2026-11-23T10:00:00");
  const next = within(screen.getByRole("region", { name: "Next trading holiday" }));
  expect(next.getByText("Tomorrow")).toBeInTheDocument();
  expect(next.getByText("Tuesday, 24 Nov 2026")).toBeInTheDocument();
  expect(next.getByText("Guru Nanak Jayanti")).toBeInTheDocument();
  expect(next.getByText("Closed")).toBeInTheDocument();
  expect(next.getByText("Open 17:00–23:55")).toBeInTheDocument();
  expect(next.getByText("After that: Fri 25 Dec · Christmas")).toBeInTheDocument();
  expect(next.getByText("2 of 16 trading holidays left in 2026")).toBeInTheDocument();
});

test("a holiday morning shows NSE shut and MCX waiting for its evening session", () => {
  renderAt("2026-11-24T11:00:00");
  expect(screen.getByRole("status")).toHaveTextContent("All exchanges are closed");
  expect(exchangeLabels()).toEqual([
    "NSE: Closed. Holiday: Guru Nanak Jayanti · Opens tomorrow 09:15", "BSE: Closed. Holiday: Guru Nanak Jayanti · Opens tomorrow 09:15",
    "NFO: Closed. Holiday: Guru Nanak Jayanti · Opens tomorrow 09:15", "BFO: Closed. Holiday: Guru Nanak Jayanti · Opens tomorrow 09:15",
    "MCX: Closed. Guru Nanak Jayanti: evening session only · Opens today 17:00",
  ]);
  expect(within(screen.getByRole("region", { name: "Next trading holiday" })).getByText("Today")).toBeInTheDocument();
});

test("the year table lists every holiday with both markets' hours, marks the next one and filters by type", () => {
  renderAt("2026-11-23T10:00:00");
  const rows = tableRows();
  expect(rows).toHaveLength(22);
  expect(rows.filter(row => row.dataset.past)).toHaveLength(20);
  const guruNanak = rows.find(row => row.dataset.date === "2026-11-24");
  expect(guruNanak).toHaveAttribute("aria-current", "date");
  expect(within(guruNanak).getAllByRole("cell").map(cell => cell.textContent))
    .toEqual(["24 Nov 2026", "Tuesday", "Guru Nanak JayantiNext", "Trading holiday", "Closed", "Open 17:00–23:55"]);
  const christmas = rows.find(row => row.dataset.date === "2026-12-25");
  expect(within(christmas).getAllByRole("cell").map(cell => cell.textContent).slice(2))
    .toEqual(["ChristmasLong weekend", "Trading holiday", "Closed", "Closed"]);
  const budget = rows.find(row => row.dataset.date === "2026-02-01");
  expect(within(budget).getAllByRole("cell").map(cell => cell.textContent).slice(3)).toEqual(["Special session", "Open 09:15–15:30", "Open 09:00–17:00"]);

  fireEvent.click(screen.getByRole("button", { name: "Settlement" }));
  expect(tableRows().map(row => row.dataset.date)).toEqual(["2026-02-19", "2026-03-19", "2026-04-01", "2026-08-26"]);
  fireEvent.click(screen.getByRole("button", { name: "Special sessions" }));
  expect(tableRows()).toHaveLength(2);
  expect(screen.getByText("16 trading · 4 settlement · 2 special")).toBeInTheDocument();
});
