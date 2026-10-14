import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import Equity from "./equity";
import EquityTerminal, { terminalChanges, TERMINAL_COLUMNS } from "./equityTerminal";
import { makeEquityPreviewApi } from "../equityFixtures";

jest.mock("./equityChart", () => ({ __esModule: true, default: ({ contract, onClose }) => <section aria-label="Test chart">{contract.symbol}<button onClick={onClose}>Collapse chart panel</button></section> }));
beforeEach(() => { localStorage.clear(); window.innerWidth = 1440; });

test("equity defaults to full-height terminal and loads chart only on demand", async () => {
  const api = makeEquityPreviewApi();
  api.history = jest.fn(api.history);
  render(<Equity api={api} username="demo" />);
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  expect(screen.getByRole("main")).toHaveClass("eq-terminal");
  expect(screen.queryByRole("region", { name: "Test chart" })).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe("hidden");
  expect(screen.queryByRole("complementary", { name: "Market depth" })).not.toBeInTheDocument();
  expect(api.history).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /View HDFCBANK.*FUT/ }));
  expect(api.history).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Open chart" }));
  expect(await screen.findByRole("region", { name: "Test chart" })).toHaveTextContent("HDFCBANK");
  expect(screen.getByRole("main")).toHaveClass("has-chart");
  await waitFor(() => expect(api.history).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Collapse chart panel" }));
  expect(screen.queryByRole("region", { name: "Test chart" })).not.toBeInTheDocument();
  expect(screen.getByRole("main")).not.toHaveClass("has-chart");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Exit terminal view" })));
  expect(screen.getByRole("main")).not.toHaveClass("eq-terminal");
  expect(document.body.style.overflow).not.toBe("hidden");
  expect(screen.queryByRole("complementary", { name: "Market depth" })).not.toBeInTheDocument();
  expect(await screen.findByRole("region", { name: "Test chart" })).toHaveTextContent("HDFCBANK");
  fireEvent.click(screen.getByRole("button", { name: "Market depth", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "Open terminal view" }));
  expect(screen.queryByRole("complementary", { name: "Market depth" })).not.toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Exit terminal view" })));
  expect(screen.getByRole("complementary", { name: "Market depth" })).toBeInTheDocument();
});

test("returning to equity opens terminal again with chart collapsed", async () => {
  const api = makeEquityPreviewApi();
  const first = render(<Equity api={api} username="demo" />);
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Exit terminal view" })));
  first.unmount();
  render(<Equity api={api} username="demo" />);
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  expect(screen.getByRole("main")).toHaveClass("eq-terminal");
  expect(screen.queryByRole("region", { name: "Test chart" })).not.toBeInTheDocument();
});

test("terminal row selection on mobile does not unexpectedly open depth", async () => {
  window.innerWidth = 390;
  render(<Equity api={makeEquityPreviewApi()} username="demo" />);
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  const row = screen.getByRole("button", { name: /View HDFCBANK.*FUT/ });
  fireEvent.click(row);
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  await act(async () => fireEvent.doubleClick(row));
  expect(screen.getByRole("region", { name: "Test chart" })).toHaveTextContent("HDFCBANK");
  expect(screen.queryByRole("button", { name: /^(buy|sell|trade|place order)$/i })).not.toBeInTheDocument();
});

test("terminal keeps options expiry and strike browsing functional", async () => {
  render(<Equity api={makeEquityPreviewApi()} username="demo" />);
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  fireEvent.click(screen.getByRole("button", { name: "Stock options" }));
  await screen.findAllByRole("button", { name: /^View RELIANCE.*CE/ });
  fireEvent.change(screen.getByLabelText("Option strike"), { target: { value: "1400" } });
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(2));
  expect(screen.getByRole("main")).toHaveClass("eq-terminal");
});

test("quantities are units and highlights only compare fresh observed values", () => {
  const contract = { id: "NFO:TEST", lotSize: 50 };
  const before = { ltp: 100, bid: 99, ask: 101, depth: { buy: [{ lots: 2 }], sell: [{ lots: 3 }] }, volumeLots: 12, oiLots: 25 };
  const after = { ...before, ltp: 101, bid: 98 };
  expect(TERMINAL_COLUMNS.find(c => c.id === "bidQty").value(before, contract)).toBe(100);
  expect(TERMINAL_COLUMNS.find(c => c.id === "volume").value(before, contract)).toBe(600);
  expect(TERMINAL_COLUMNS.find(c => c.id === "bidQty").value({}, contract)).toBeNull();
  expect(terminalChanges({}, { [contract.id]: after }, [contract])).toEqual({});
  expect(terminalChanges({ [contract.id]: before }, { [contract.id]: after }, [contract])).toEqual({ "NFO:TEST:ltp": "up", "NFO:TEST:bid": "down" });
  expect(terminalChanges({ [contract.id]: before }, { [contract.id]: { ...after, stale: true } }, [contract])).toEqual({});
});

test("a delayed broker snapshot cannot move the displayed price backwards in time", async () => {
  const api = makeEquityPreviewApi(), quotes = api.quotes;
  const fetchedAt = Date.now() / 1000;
  let snapshot = { ltp: 101, quotedAt: "2026-10-13T10:00:04+05:30", fetchedAt };
  api.quotes = async ids => {
    const response = await quotes(ids);
    return { ...response, quotes: Object.fromEntries(Object.entries(response.quotes).map(([id, quote]) => [id, { ...quote, ...snapshot }])) };
  };
  render(<Equity api={api} username="demo" />);
  const row = (await screen.findByRole("button", { name: /View RELIANCE.*FUT/ })).closest("tr");
  const price = () => row.querySelector('[data-column="ltp"]');
  await waitFor(() => expect(price()).toHaveTextContent("101.00"));
  snapshot = { ltp: 95, quotedAt: "2026-10-13T10:00:00+05:30", fetchedAt: fetchedAt + 4 };
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh equity quotes" })));
  expect(price()).toHaveTextContent("101.00");
  expect(price()).not.toHaveClass("terminal-tick-down");
  snapshot = { ltp: 99, quotedAt: "2026-10-13T10:00:08+05:30", fetchedAt: fetchedAt + 8 };
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Refresh equity quotes" })));
  expect(price()).toHaveTextContent("99.00");
  expect(price()).toHaveClass("terminal-tick-down");
});

test("repeated or older snapshots and invisible precision differences do not flash", () => {
  const contracts = [{ id: "NFO:A", lotSize: 50 }];
  const before = { ltp: 101, bid: 100.1, quotedAt: "2026-10-13T10:00:04+05:30", fetchedAt: 100 };
  const compare = quote => terminalChanges({ "NFO:A": before }, { "NFO:A": quote }, contracts);
  expect(compare({ ...before })).toEqual({});
  expect(compare({ ...before, ltp: 95, quotedAt: "2026-10-13T10:00:00+05:30", fetchedAt: 104 })).toEqual({});
  expect(compare({ ...before, bid: 100.10000000001, fetchedAt: 104 })).toEqual({});
  expect(compare({ ...before, bid: 100.15, fetchedAt: 104 })).toEqual({ "NFO:A:bid": "up" });
});

test("changed cells flash briefly, sort correctly and keyboard selection works", () => {
  jest.useFakeTimers();
  try {
    const rows = [{ id: "NFO:A", symbol: "A", underlying: "A", lotSize: 50 }, { id: "NFO:B", symbol: "B", underlying: "B", lotSize: 25 }];
    const onSelect = jest.fn();
    const ui = quotes => <DndContext><EquityTerminal rows={rows} quotes={quotes} selectedId="NFO:A" onSelect={onSelect} onChart={() => {}} watchedIds={[]} onWatch={() => {}} /></DndContext>;
    const view = render(ui({ "NFO:A": { ltp: 100 }, "NFO:B": { ltp: 80 } }));
    view.rerender(ui({ "NFO:A": { ltp: 101 }, "NFO:B": { ltp: 80 } }));
    expect(screen.getByText("101.00")).toHaveClass("terminal-tick-up");
    act(() => jest.advanceTimersByTime(1100));
    expect(screen.getByText("101.00")).not.toHaveClass("terminal-tick-up");
    fireEvent.click(screen.getByRole("button", { name: "LTP" }));
    expect(screen.getAllByRole("button", { name: /^View / }).map(button => button.textContent)).toEqual(["B", "A"]);
    fireEvent.keyDown(screen.getByRole("button", { name: "View A" }), { key: "ArrowUp" });
    expect(onSelect).toHaveBeenCalledWith(rows[1]);
    view.unmount();
  } finally { jest.useRealTimers(); }
});
