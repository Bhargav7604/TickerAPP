import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createChart } from "lightweight-charts";
import MoneyFlow, { measurePaths } from "./moneyFlow";
import { CONDS, FLOW_TAGS, analyse, decodeSnapshot, inView, sectorFlow } from "../boardData";
import { makeBoardSnapshot, makeScanner } from "../boardFixtures";

jest.mock("lightweight-charts", () => ({ createChart: jest.fn(), CandlestickSeries: "candles", ColorType: { Solid: "solid" } }));
// The project's Jest config resets mocks before every test, so the chart stub is rebuilt here.
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  createChart.mockImplementation(() => ({
    addSeries: () => ({ setData: jest.fn(), applyOptions: jest.fn(), update: jest.fn() }), applyOptions: jest.fn(),
    timeScale: () => ({ setVisibleLogicalRange: jest.fn(), fitContent: jest.fn() }), remove: jest.fn(),
  }));
});

const decoded = () => decodeSnapshot(makeBoardSnapshot());

function makeApi() {
  return {
    snapshot: jest.fn(async () => makeBoardSnapshot()),
    scanner: jest.fn(async bars => makeScanner(bars)),
    candles: jest.fn(async symbol => ({ symbol, candles: [], message: "" })),
  };
}

async function renderPage(api = makeApi()) {
  await act(async () => { render(<MoneyFlow api={api} />); });
  await screen.findByRole("region", { name: "What the board sees" });
  await screen.findByText(/lead the strong bulls|No name has enough agreement/);
  return api;
}

test("shows the read line, sectors, seven conditions with delivery off, tunnels and strong tables", async () => {
  const api = await renderPage();
  expect(api.scanner).toHaveBeenCalledWith(3, expect.anything());
  const A = analyse(decoded().stocks);
  expect(screen.getByRole("heading", { level: 1, name: "Money Flow" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "What the board sees" })).toHaveTextContent(/Viewing All \(NIFTY 500 \+ F&O\): \d+ up · \d+ down/);
  expect(screen.getByText("145 of 145 names")).toBeInTheDocument();
  const sectors = within(screen.getByRole("region", { name: "Sectors" })).getAllByRole("button");
  expect(sectors).toHaveLength(A.sectors.length);
  expect(sectors[0]).toHaveTextContent(A.sectors[0].sector);
  CONDS.forEach(cond => expect(screen.getByRole("region", { name: cond.name })).toBeInTheDocument());
  expect(screen.getByRole("region", { name: "Delivery" })).toHaveTextContent(/Off: needs delivery %/);
  const change = screen.getByRole("region", { name: "% Change" });
  expect(change).toHaveTextContent(`BULLS ${A.conds[0].bulls.length}`);
  expect(within(change).getByRole("button", { name: A.conds[0].bTop[0].st.sym })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Bullish names" })).toHaveTextContent(String(A.inBull));
  expect(screen.getByRole("group", { name: "Bearish names" })).toHaveTextContent(String(A.inBear));
  const bulls = within(screen.getByRole("list", { name: "Strong bull names" })).getAllByRole("listitem");
  expect(bulls).toHaveLength(Math.min(14, A.strongB.length));
  expect(bulls[0]).toHaveAccessibleName(A.strongB[0].sym);
  expect(bulls[0]).toHaveTextContent(`${A.mem[A.strongB[0].sym].bull.size}/${A.nAvail}`);
  expect(within(screen.getByRole("list", { name: "Strong bear names" })).getAllByRole("listitem")).toHaveLength(Math.min(14, A.strongS.length));
  expect(screen.getByRole("region", { name: "Market breadth" })).toHaveTextContent("Sensex 30");
  expect(screen.getByText(/rule: top 10 per condition/)).toBeInTheDocument();
});

test("the segment filter narrows the board and is remembered", async () => {
  await renderPage();
  const select = document.querySelector('[role="combobox"][aria-label="Stocks"]');
  await act(async () => { fireEvent.change(select.parentElement.querySelector("input"), { target: { value: "sx" } }); });
  const sensex = analyse(decoded().stocks.filter(st => inView(st, "sx")));
  expect(screen.getByText("30 of 145 names")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Bullish names" })).toHaveTextContent(String(sensex.inBull));
  expect(screen.getByRole("region", { name: "What the board sees" })).toHaveTextContent("Viewing Sensex 30:");
  expect(screen.getByRole("region", { name: "Signal log" })).toHaveTextContent("view switched to Sensex 30");
  expect(JSON.parse(localStorage.getItem("utraders-board-filter"))).toEqual({ segment: "sx", cap: "all" });
});

test("who moves the index switches between NIFTY and SENSEX", async () => {
  await renderPage();
  const panel = screen.getByRole("region", { name: "Who moves the index" });
  expect(panel).toHaveTextContent("▲ PUSHING UP");
  expect(panel).toHaveTextContent(/pts/);
  expect(within(panel).getByRole("button", { name: "NIFTY" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(panel).getByRole("button", { name: "SENSEX" }));
  expect(panel).toHaveTextContent("No SENSEX stock weights yet");
});

test("clicking a strong name opens its stock card", async () => {
  const api = await renderPage();
  const A = analyse(decoded().stocks);
  const sym = A.strongB[0].sym;
  const list = screen.getByRole("list", { name: "Strong bull names" });
  await act(async () => { fireEvent.click(within(list).getByRole("button", { name: sym })); });
  expect(await screen.findByRole("heading", { level: 2, name: sym })).toBeInTheDocument();
  expect(api.candles).toHaveBeenCalledWith(sym, expect.anything());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close stock card" })); });
});

test("the sector smart-money table shows verdicts and locks a sector on the board", async () => {
  await renderPage();
  const flows = sectorFlow(decoded().stocks);
  const table = screen.getByRole("table", { name: "Sector money flow" });
  const rows = within(table).getAllByRole("row");
  expect(rows).toHaveLength(flows.length + 1);
  expect(rows[1]).toHaveAccessibleName(flows[0].sector);
  expect(rows[1]).toHaveTextContent(FLOW_TAGS[flows[0].tag]);
  expect(screen.getByRole("region", { name: "Sector smart-money flow" })).toHaveTextContent(/Delivery % is not available from Zerodha/);
  fireEvent.click(rows[2]);
  expect(screen.getByText(`Tracing ${flows[1].sector}`)).toBeInTheDocument();
  expect(rows[2]).toHaveAttribute("aria-selected", "true");
  const sectorButton = within(screen.getByRole("region", { name: "Sectors" })).getAllByRole("button").find(b => b.dataset.sectorRow === flows[1].sector);
  expect(sectorButton).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(sectorButton);
  expect(screen.queryByText(`Tracing ${flows[1].sector}`)).not.toBeInTheDocument();
});

test("a sector sent from the Market page is traced once", async () => {
  sessionStorage.setItem("utraders-flow-sector", "IT");
  await renderPage();
  expect(screen.getByText("Tracing IT")).toBeInTheDocument();
  expect(sessionStorage.getItem("utraders-flow-sector")).toBeNull();
  const it = within(screen.getByRole("region", { name: "Sectors" })).getAllByRole("button").find(b => b.dataset.sectorRow === "IT");
  expect(it).toHaveAttribute("aria-pressed", "true");
});

test("flow lines run sector → condition → tunnel → strong row", () => {
  const board = document.createElement("div");
  const box = (attrs, rect) => {
    const el = document.createElement("div");
    Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
    el.getBoundingClientRect = () => ({ left: rect[0], right: rect[1], top: rect[2], bottom: rect[3], width: rect[1] - rect[0], height: rect[3] - rect[2] });
    board.appendChild(el);
    return el;
  };
  board.getBoundingClientRect = () => ({ left: 0, right: 1600, top: 0, bottom: 900, width: 1600, height: 900 });
  Object.defineProperty(board, "clientWidth", { value: 1600, configurable: true });
  box({ "data-sector-row": "IT" }, [0, 200, 100, 120]);
  box({ "data-cond": "chg" }, [260, 520, 0, 100]);
  box({ "data-tunnel": "bull" }, [580, 860, 0, 60]);
  box({ "data-tunnel": "bear" }, [580, 860, 70, 130]);
  box({ "data-strong-row": "", "data-side": "bull", "data-sym": "INFY" }, [920, 1500, 200, 220]);
  const st = { sym: "INFY", sector: "IT" };
  const A = { conds: [{ id: "chg", avail: true, bTop: [{ st }], sTop: [] }, { id: "del", avail: false, bTop: [], sTop: [] }], strongB: [st], strongS: [] };
  const paths = measurePaths(board, A);
  expect(paths.map(p => [p.sym, p.side, Boolean(p.strong)])).toEqual([["INFY", "bull", false], ["INFY", "bull", false], ["INFY", "bull", true]]);
  expect(paths[0].d).toMatch(/^M200\.0 /);
  expect(paths[1].d).toMatch(/^M520\.0 /);
  expect(paths[2].d).toMatch(/^M860\.0 29\.4 C/);  // tunnel middle, nudged per row
  expect(paths[2].d).toMatch(/920\.0 210\.0$/);
  Object.defineProperty(board, "clientWidth", { value: 800, configurable: true });
  expect(measurePaths(board, A)).toEqual([]);
});
