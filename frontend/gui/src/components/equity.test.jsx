import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Equity from "./equity";
import { makeEquityPreviewApi } from "../equityFixtures";
import { equityPollDelay, futuresForMonth, readEquityPreferences } from "../equityData";
import { ThemeProvider } from "../theme";
import Navbar from "./navbar";

jest.mock("./equityChart", () => ({ __esModule: true, default: ({ contract, candles }) => <div data-testid="equity-chart">{contract.symbol} / {candles.length} candles</div> }));

beforeEach(() => { localStorage.clear(); window.innerWidth = 1440; });
afterEach(() => { delete document.documentElement.dataset.theme; });

test("watchlist selection remains highlighted when the theme changes", async () => {
  render(<ThemeProvider><Navbar currentPage="equity" /><Equity api={makeEquityPreviewApi()} username="demo" /></ThemeProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Exit terminal view" }));
  const selected = await screen.findByRole("button", { name: /View HDFCBANK.*FUT/ });
  await act(async () => { fireEvent.click(selected); });
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(selected.closest("tr")).toHaveClass("is-selected");
  fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expect(selected).toHaveAttribute("aria-pressed", "true");
  expect(selected.closest("tr")).toHaveClass("is-selected");
  expect(screen.getByRole("button", { name: /View RELIANCE.*FUT/ }).closest("tr")).not.toHaveClass("is-selected");
});

test("read-only watchlist and collapsible depth preserve data", async () => {
  render(<Equity api={makeEquityPreviewApi()} username="demo" />);
  fireEvent.click(screen.getByRole("button", { name: "Exit terminal view" }));
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  await waitFor(() => expect(screen.getAllByText("1,408.20").length).toBeGreaterThan(0));
  expect(screen.queryByRole("complementary", { name: "Market depth" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Market depth" }));
  expect(screen.getByRole("complementary", { name: "Market depth" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Hide depth" })).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("button", { name: "Collapse market depth" }));
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^(buy|sell|trade|place order)$/i })).not.toBeInTheDocument();
});

test("mobile row selection expands depth and collapse persists", async () => {
  window.innerWidth = 390;
  render(<Equity api={makeEquityPreviewApi()} username="demo" />);
  fireEvent.click(screen.getByRole("button", { name: "Exit terminal view" }));
  fireEvent.click(await screen.findByRole("button", { name: /View HDFCBANK.*FUT/ }));
  expect(screen.getByRole("complementary")).toHaveTextContent("HDFCBANK");
  fireEvent.click(screen.getByRole("button", { name: "Collapse market depth" }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem("index-tool-equity-v1:preview")).depthOpen).toBe(false));
});

test("search can add only the requested CE contract to an empty named list", async () => {
  render(<Equity api={makeEquityPreviewApi()} username="demo" />);
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  fireEvent.click(screen.getByRole("button", { name: "New watchlist" }));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Options only" } });
  fireEvent.click(screen.getByRole("button", { name: "Create watchlist" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search stock futures or options" }), { target: { value: "RELIANCE CE" } });
  const add = (await screen.findAllByRole("button", { name: /^Add RELIANCE.*CE to watchlist$/ }))[0];
  fireEvent.click(add);
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(await screen.findByRole("button", { name: /View RELIANCE.*CE/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /View .*FUT/ })).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("index-tool-equity-v1:preview")).lists.find(list => list.name === "Options only").ids).toHaveLength(1);
});

test("next month replaces displayed futures without mixing current data", async () => {
  const api = makeEquityPreviewApi();
  const catalog = await api.contracts({ kind: "FUT" });
  const next = futuresForMonth(catalog.contracts, 1);
  render(<Equity api={api} username="demo" />);
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  fireEvent.click(screen.getByRole("button", { name: "All futures" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByRole("button", { name: `View ${next[0].symbol}` })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(8);
  expect(screen.getAllByRole("button", { name: /^View / }).every(button => next.some(contract => button.getAttribute("aria-label") === `View ${contract.symbol}`))).toBe(true);
});

test("column settings hide and reorder desktop metrics", async () => {
  render(<Equity api={makeEquityPreviewApi()} username="demo" />);
  fireEvent.click(screen.getByRole("button", { name: "Exit terminal view" }));
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  fireEvent.click(screen.getByRole("button", { name: "Customize equity columns" }));
  fireEvent.click(screen.getByLabelText("Bid"));
  fireEvent.click(screen.getByRole("button", { name: "Move oiLots up" }));
  fireEvent.click(screen.getByRole("button", { name: "Save columns" }));
  expect(screen.queryByRole("button", { name: "Bid" })).not.toBeInTheDocument();
  const prefs = JSON.parse(localStorage.getItem("index-tool-equity-v1:preview"));
  expect(prefs.columns).toEqual(["ltp", "changePct", "ask", "oiLots", "volumeLots"]);
});

test("saved watchlists survive remount and remain scoped to the user", async () => {
  const api = makeEquityPreviewApi(); api.preview = false;
  const first = render(<Equity api={api} username="first" />);
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  fireEvent.click(screen.getByRole("button", { name: /Remove RELIANCE.*FUT/ }));
  first.unmount();
  const second = render(<Equity api={api} username="first" />);
  await screen.findByRole("button", { name: /View HDFCBANK.*FUT/ });
  expect(screen.queryByRole("button", { name: /View RELIANCE.*FUT/ })).not.toBeInTheDocument();
  second.unmount();
  render(<Equity api={api} username="second" />);
  expect(await screen.findByRole("button", { name: /View RELIANCE.*FUT/ })).toBeInTheDocument();
});

test("quote errors show unavailable values, not sample quotes", async () => {
  const api = makeEquityPreviewApi(); api.preview = false;
  api.quotes = async () => { throw new Error("Broker session expired"); };
  render(<Equity api={api} username="demo" />);
  expect(await screen.findByText("Broker session expired")).toBeInTheDocument();
  expect(screen.queryByText("1,408.20")).not.toBeInTheDocument();
  expect(screen.queryByText("Sample data")).not.toBeInTheDocument();
});

test("a late chart response cannot overwrite a newly selected contract", async () => {
  const api = makeEquityPreviewApi();
  let resolveFirst;
  api.history = jest.fn().mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }))
    .mockResolvedValue({ candles: [{ time: 1, close: 25, volume: 2 }] });
  render(<Equity api={api} username="demo" />);
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  fireEvent.click(screen.getByRole("button", { name: "Open chart" }));
  await waitFor(() => expect(api.history).toHaveBeenCalledTimes(1));
  fireEvent.click(await screen.findByRole("button", { name: /View HDFCBANK.*FUT/ }));
  await waitFor(() => expect(screen.getByTestId("equity-chart")).toHaveTextContent("1 candles"));
  await act(async () => resolveFirst({ candles: [{ time: 1 }, { time: 2 }] }));
  expect(screen.getByTestId("equity-chart")).toHaveTextContent("HDFCBANK");
  expect(screen.getByTestId("equity-chart")).toHaveTextContent("1 candles");
});

test("missing far futures do not silently substitute a different expiry", () => {
  expect(futuresForMonth([{ underlying: "ABC", kind: "FUT", expiry: "2030-01-29" }], 2)).toEqual([]);
});

test("Options browses stock, expiry, strike and side without changing an empty watchlist", async () => {
  localStorage.setItem("index-tool-equity-v1:preview", JSON.stringify({ lists: [{ id: "empty", name: "Empty", ids: [] }] }));
  const api = makeEquityPreviewApi();
  const metadata = (await api.contracts({ kind: "options", underlying: "HDFCBANK" })).filters;
  render(<Equity api={api} username="demo" />);
  fireEvent.click(screen.getByRole("button", { name: "Options", exact: true }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^View RELIANCE/ })).toHaveLength(6));
  expect(screen.queryByRole("button", { name: /^View .*FUT/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Option stock"), { target: { value: "HDFCBANK" } });
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^View HDFCBANK/ })).toHaveLength(6));
  fireEvent.change(screen.getByLabelText("Option expiry"), { target: { value: metadata.expiries[1] } });
  await waitFor(() => expect(screen.getByLabelText("Option strike")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Option strike"), { target: { value: String(metadata.strikes[1]) } });
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Option type"), { target: { value: "PE" } });
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(1));
  expect(screen.getByRole("button", { name: /^View HDFCBANK.*PE/ })).toBeInTheDocument();
  expect(screen.getByLabelText("Option expiry")).toHaveValue(metadata.expiries[1]);
  expect(JSON.parse(localStorage.getItem("index-tool-equity-v1:preview")).lists[0].ids).toEqual([]);
});

test("changing stock resets expiry and strike and ignores late options responses", async () => {
  const api = makeEquityPreviewApi();
  const contracts = api.contracts;
  let late;
  api.contracts = jest.fn(params => params.underlying === "HDFCBANK"
    ? new Promise(resolve => { late = resolve; }) : contracts(params));
  render(<Equity api={api} username="demo" />);
  fireEvent.click(screen.getByRole("button", { name: "Options", exact: true }));
  await screen.findAllByRole("button", { name: /^View RELIANCE.*CE/ });
  fireEvent.change(screen.getByLabelText("Option strike"), { target: { value: "1400" } });
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Option stock"), { target: { value: "HDFCBANK" } });
  expect(screen.queryByRole("button", { name: /^View / })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Option strike")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Option stock"), { target: { value: "SBIN" } });
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^View SBIN/ })).toHaveLength(6));
  await act(async () => late(await contracts({ kind: "options", underlying: "HDFCBANK" })));
  expect(screen.queryByRole("button", { name: /^View HDFCBANK/ })).not.toBeInTheDocument();
});

test("options catalogue error is shown without stale rows", async () => {
  const api = makeEquityPreviewApi(), contracts = api.contracts;
  api.contracts = params => params.kind === "options" ? Promise.reject(new Error("Catalogue offline")) : contracts(params);
  render(<Equity api={api} username="demo" />);
  fireEvent.click(screen.getByRole("button", { name: "Stock options", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Catalogue offline");
  expect(screen.queryByRole("button", { name: /^View / })).not.toBeInTheDocument();
});

test("options pagination fetches the requested page and preserves filters", async () => {
  const api = makeEquityPreviewApi(), contracts = api.contracts;
  api.contracts = jest.fn(async params => {
    const result = await contracts(params);
    return params.kind === "options" ? { ...result, total: 60 } : result;
  });
  render(<Equity api={api} username="demo" />);
  fireEvent.click(screen.getByRole("button", { name: "Options", exact: true }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Next contracts" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Next contracts" }));
  await waitFor(() => expect(api.contracts).toHaveBeenCalledWith(expect.objectContaining({ kind: "options", page: 1 }), expect.anything()));
  expect(screen.getByLabelText("Option stock")).toHaveValue("RELIANCE");
});

test("pending quotes and charts retry promptly instead of waiting a full polling interval", async () => {
  const api = makeEquityPreviewApi(), quotes = api.quotes, history = api.history;
  api.quotes = jest.fn().mockResolvedValueOnce({ status: "waiting", quotes: {}, retryAfterMs: 250 }).mockImplementation(quotes);
  api.history = jest.fn().mockResolvedValueOnce({ candles: [], message: "Loading chart. Please wait.", retryAfterMs: 250 }).mockImplementation(history);
  render(<Equity api={api} username="demo" />);
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  fireEvent.click(screen.getByRole("button", { name: "Open chart" }));
  await waitFor(() => expect(api.quotes).toHaveBeenCalledTimes(2), { timeout: 1500 });
  await waitFor(() => expect(screen.getByTestId("equity-chart")).toHaveTextContent("27 candles"), { timeout: 1500 });
  expect(api.history).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("Waiting for quotes...")).not.toBeInTheDocument();
});

test("refresh preserves a searched contract outside the watchlist", async () => {
  const api = makeEquityPreviewApi(); api.preview = false;
  render(<Equity api={api} username="demo" />);
  await screen.findByRole("button", { name: /View RELIANCE.*FUT/ });
  fireEvent.click(screen.getByRole("button", { name: "Open chart" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search stock futures or options" }), { target: { value: "RELIANCE CE" } });
  fireEvent.click((await screen.findAllByRole("button", { name: /^RELIANCE .*CE \/ / }))[0]);
  await waitFor(() => expect(screen.getByTestId("equity-chart")).toHaveTextContent("CE /"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh equity quotes" }));
  await waitFor(() => expect(screen.getByTestId("equity-chart")).toHaveTextContent("27 candles"));
  expect(screen.getByTestId("equity-chart")).toHaveTextContent("CE /");
});

test("retry delays are bounded and jittered, and normal polling stays unchanged", () => {
  expect(equityPollDelay({ retryAfterMs: 1100 }, 4000)).toBeGreaterThanOrEqual(1150);
  expect(equityPollDelay({ retryAfterMs: 1100 }, 4000)).toBeLessThan(1400);
  expect(equityPollDelay({ retryAfterMs: null }, 4000)).toBe(4000);
  expect(equityPollDelay({}, 60000)).toBe(60000);
});

test("corrupted preferences and unknown columns are handled", () => {
  localStorage.setItem("bad", "{");
  expect(readEquityPreferences("bad").initialise).toBe(true);
  localStorage.setItem("bad", JSON.stringify({ lists: [{ id: "a", name: "Test", ids: ["NFO:ABC", "NSE:CASH"] }], columns: ["fake", "ltp", "ltp"] }));
  expect(readEquityPreferences("bad").columns).toEqual(["ltp"]);
  expect(readEquityPreferences("bad").lists[0].ids).toEqual(["NFO:ABC"]);
});
