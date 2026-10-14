import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Equity from "./equity";
import { makeEquityPreviewApi } from "../equityFixtures";
import { contractLabel, makeEquityApi, readEquityPreferences } from "../equityData";

jest.mock("./equityChart", () => ({ __esModule: true, default: ({ contract, candles }) => <div data-testid="equity-chart">{contract.symbol} / {candles.length} candles</div> }));

beforeEach(() => { localStorage.clear(); window.innerWidth = 1440; });

test("Index Options opens all three index selectors, without futures or order controls", async () => {
  render(<Equity indexOptions api={makeEquityPreviewApi(true)} username="demo" />);
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^View NIFTY/ })).toHaveLength(6));
  expect(screen.getByRole("heading", { name: "Index Options" })).toBeInTheDocument();
  expect(screen.getByRole("main")).not.toHaveClass("eq-terminal");
  expect(screen.getByRole("button", { name: "Open terminal view" })).toBeInTheDocument();
  expect(within(screen.getByLabelText("Option index")).getAllByRole("option").map(option => option.value)).toEqual(["NIFTY", "BANKNIFTY", "SENSEX"]);
  expect(screen.queryByRole("button", { name: /^(All futures|Futures|Buy|Sell|Place order)$/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^View .*FUT/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Search index options")).toBeInTheDocument();
});

test("index, expiry, strike and side controls load the selected index contract and chart", async () => {
  const api = makeEquityPreviewApi(true);
  const metadata = (await api.contracts({ kind: "options", underlying: "SENSEX" })).filters;
  render(<Equity indexOptions api={api} username="demo" />);
  await screen.findAllByRole("button", { name: /^View NIFTY/ });
  for (const name of ["BANKNIFTY", "SENSEX"]) {
    fireEvent.change(screen.getByLabelText("Option index"), { target: { value: name } });
    await waitFor(() => expect(screen.getAllByRole("button", { name: new RegExp(`^View ${name}`) })).toHaveLength(6));
  }
  fireEvent.change(screen.getByLabelText("Option expiry"), { target: { value: metadata.expiries[1] } });
  await waitFor(() => expect(screen.getByLabelText("Option strike")).not.toBeDisabled());
  fireEvent.change(screen.getByLabelText("Option strike"), { target: { value: String(metadata.strikes[1]) } });
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Option type"), { target: { value: "PE" } });
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(1));
  await waitFor(() => expect(screen.getByTestId("equity-chart")).toHaveTextContent("PE / 27 candles"));
  expect(screen.getByTestId("equity-chart")).toHaveTextContent("SENSEX");
  expect(screen.getByLabelText("Option expiry")).toHaveValue(metadata.expiries[1]);
});

test("BFO watchlists persist separately from equity watchlists", async () => {
  const stockPrefs = { lists: [{ id: "stocks", name: "Stocks", ids: ["NFO:RELIANCEFUT"] }] };
  localStorage.setItem("index-tool-equity-v1:preview", JSON.stringify(stockPrefs));
  const api = makeEquityPreviewApi(true);
  const view = render(<Equity indexOptions api={api} username="demo" />);
  await screen.findAllByRole("button", { name: /^View NIFTY/ });
  fireEvent.change(screen.getByLabelText("Option index"), { target: { value: "SENSEX" } });
  const add = (await screen.findAllByRole("button", { name: /^Add SENSEX/ }))[0];
  fireEvent.click(add);
  fireEvent.click(screen.getByRole("button", { name: "My watchlists" }));
  expect(await screen.findByRole("button", { name: /^View SENSEX/ })).toBeInTheDocument();
  const saved = JSON.parse(localStorage.getItem("index-tool-index-options-v1:preview"));
  expect(saved.lists[0].ids).toHaveLength(1);
  expect(saved.lists[0].ids[0]).toMatch(/^BFO:/);
  expect(JSON.parse(localStorage.getItem("index-tool-equity-v1:preview"))).toEqual(stockPrefs);
  view.unmount();
  render(<Equity indexOptions api={api} username="demo" />);
  fireEvent.click(screen.getByRole("button", { name: "My watchlists" }));
  expect(await screen.findByRole("button", { name: /^View SENSEX/ })).toBeInTheDocument();
});

test("mobile index row expands the matching depth panel", async () => {
  window.innerWidth = 390;
  render(<Equity indexOptions api={makeEquityPreviewApi(true)} username="demo" />);
  fireEvent.click((await screen.findAllByRole("button", { name: /^View NIFTY/ }))[1]);
  expect(screen.getByRole("complementary", { name: "Market depth" })).toHaveTextContent("NIFTY");
  expect(screen.getByRole("complementary", { name: "Market depth" })).toHaveTextContent("PE");
  await waitFor(() => expect(screen.getByTestId("equity-chart")).toHaveTextContent("27 candles"));
  fireEvent.click(screen.getByRole("button", { name: "Collapse market depth" }));
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
});

test("index labels distinguish weekly expiries and BFO preferences stay opt-in", () => {
  const first = { expiry: "2030-10-01", kind: "CE", strike: 22500 };
  const second = { ...first, expiry: "2030-10-08" };
  expect(contractLabel(first, true)).toBe("01 OCT 22,500 CE");
  expect(contractLabel(first, true)).not.toBe(contractLabel(second, true));
  expect(contractLabel(first)).toBe(contractLabel(second));
  localStorage.setItem("prefs", JSON.stringify({ lists: [{ id: "a", name: "a", ids: ["NFO:NIFTYCE", "BFO:SENSEXCE", "NSE:CASH"] }] }));
  expect(readEquityPreferences("prefs").lists[0].ids).toEqual(["NFO:NIFTYCE"]);
  expect(readEquityPreferences("prefs", ["NFO:", "BFO:"]).lists[0].ids).toEqual(["NFO:NIFTYCE", "BFO:SENSEXCE"]);
});

test("index API uses separate endpoints and preserves BFO identifiers", async () => {
  const request = jest.fn().mockResolvedValue({ type: "success" });
  const api = makeEquityApi(request, "index-options");
  await api.contracts({ kind: "options", underlying: "SENSEX" });
  await api.quotes(["BFO:SENSEXCE"]);
  await api.history("BFO:SENSEXCE");
  expect(request.mock.calls.map(call => call[0])).toEqual([
    "index-options/contracts/?kind=options&underlying=SENSEX",
    "index-options/quotes/?ids=BFO%3ASENSEXCE", "index-options/history/?ids=BFO%3ASENSEXCE",
  ]);
});

test("strike choices use plain digits for keyboard type-ahead", async () => {
  render(<Equity indexOptions api={makeEquityPreviewApi(true)} username="demo" />);
  await screen.findAllByRole("button", { name: /^View NIFTY/ });
  fireEvent.change(screen.getByLabelText("Option index"), { target: { value: "BANKNIFTY" } });
  await screen.findAllByRole("button", { name: /^View BANKNIFTY/ });
  const strikes = within(screen.getByLabelText("Option strike"));
  expect(strikes.getByRole("option", { name: "55300", exact: true })).toHaveValue("55300");
  expect(strikes.queryByRole("option", { name: "55,300", exact: true })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Option strike"), { target: { value: "55300" } });
  await waitFor(() => expect(screen.getAllByRole("button", { name: /^View BANKNIFTY.*55300/ })).toHaveLength(2));
});

test.each(["bank nifty 55300", "BANKNIFTY 55,300", "BANKNIFTY 55 300"])("search handles strike query %s", async query => {
  render(<Equity indexOptions api={makeEquityPreviewApi(true)} username="demo" />);
  await screen.findAllByRole("button", { name: /^View NIFTY/ });
  fireEvent.change(screen.getByRole("textbox", { name: "Search index options" }), { target: { value: query } });
  const matches = await screen.findAllByRole("button", { name: /^Add BANKNIFTY.*55300.*to watchlist$/ });
  expect(matches).toHaveLength(6);
});

test("strike type-ahead keeps focus while only the contract results refresh", async () => {
  const api = makeEquityPreviewApi(true), contracts = api.contracts;
  let finish;
  api.contracts = params => params.strike === "55300"
    ? new Promise(resolve => { finish = resolve; }) : contracts(params);
  render(<Equity indexOptions api={api} username="demo" />);
  await screen.findAllByRole("button", { name: /^View NIFTY/ });
  fireEvent.change(screen.getByLabelText("Option index"), { target: { value: "BANKNIFTY" } });
  expect(screen.getByLabelText("Option strike")).toBeDisabled();
  await screen.findAllByRole("button", { name: /^View BANKNIFTY/ });
  const selector = screen.getByLabelText("Option strike");
  selector.focus();
  fireEvent.change(selector, { target: { value: "55300" } });
  expect(screen.getByRole("group", { name: "Index option filters" })).toHaveAttribute("aria-busy", "true");
  expect(selector).not.toBeDisabled();
  expect(selector).toHaveFocus();
  await act(async () => finish(await contracts({ kind: "options", underlying: "BANKNIFTY", strike: "55300" })));
  expect(screen.getAllByRole("button", { name: /^View BANKNIFTY.*55300/ })).toHaveLength(2);
});
