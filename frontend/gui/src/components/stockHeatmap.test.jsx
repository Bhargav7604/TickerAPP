import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import StockHeatmap, { heatColor, squarify } from "./stockHeatmap";
import IndexStocks from "./indexStocks";

const tile = (symbol, sector, changePct, value) => ({ symbol, company: `${symbol} Ltd`, sector, ltp: 100 + changePct, changePct, value });

function heatmap(overrides = {}) {
  const tiles = [tile("RELIANCE", "Oil & Gas", 7.71, 9e9), tile("ONGC", "Oil & Gas", -0.41, 2e9), tile("HDFCBANK", "Financial Services", 0.6, 8e9),
    tile("SBIN", "Financial Services", -1.2, 5e9), tile("INFY", "IT", -1.31, 4e9), tile("TCS", "IT", 0.2, 0)];
  return {
    type: "success", index: "nifty500", label: "NIFTY 500", marketOpen: true, tiles,
    sectors: [{ name: "Financial Services", value: 13e9, avgChangePct: -0.3, up: 1, down: 1, count: 2 },
      { name: "Oil & Gas", value: 11e9, avgChangePct: 3.65, up: 1, down: 1, count: 2 }, { name: "IT", value: 4e9, avgChangePct: -0.56, up: 1, down: 1, count: 2 }],
    breadth: { up: 3, down: 3, flat: 0, mood: "Mixed: stocks are split", moodSide: "flat" },
    spot: { ltp: 21500, change: 100, changePct: 0.47 }, asOf: 1793600000, missing: [], retryAfterMs: null, message: "", ...overrides,
  };
}

const byTitle = (root, title) => [...root.querySelectorAll("[title]")].find(node => node.getAttribute("title") === title);

beforeEach(() => localStorage.clear());

test("squarify fills the box exactly with areas in proportion", () => {
  const placed = squarify([{ size: 6 }, { size: 6 }, { size: 4 }, { size: 3 }, { size: 2 }, { size: 2 }, { size: 1 }], { x: 0, y: 0, w: 600, h: 400 });
  const area = placed.reduce((sum, box) => sum + box.w * box.h, 0);
  expect(area).toBeCloseTo(240000, 3);
  placed.forEach(box => {
    expect(box.w * box.h).toBeCloseTo(240000 * box.size / 24, 3);
    expect(box.x).toBeGreaterThanOrEqual(-1e-9);
    expect(box.y).toBeGreaterThanOrEqual(-1e-9);
    expect(box.x + box.w).toBeLessThanOrEqual(600 + 1e-6);
    expect(box.y + box.h).toBeLessThanOrEqual(400 + 1e-6);
  });
  expect(squarify([], { x: 0, y: 0, w: 10, h: 10 })).toEqual([]);
});

test("colour deepens with the size of the move", () => {
  expect(heatColor(0).background).toBe("rgb(38,46,62)");
  expect(heatColor(3)).toEqual({ background: "rgb(95,227,166)", color: "#06281b" });
  expect(heatColor(-5).background).toBe("rgb(226,71,94)");
  expect(heatColor(-0.5).color).toBe("#f1f5f9");
});

test("draws a box per stock inside its sector and explains a tapped stock", async () => {
  const onOpenDetails = jest.fn();
  const api = { heatmap: jest.fn(async () => heatmap()) };
  await act(async () => { render(<StockHeatmap api={api} index="nifty" onOpenDetails={onOpenDetails} />); });
  expect(api.heatmap).toHaveBeenCalledWith("nifty", expect.anything());
  const map = screen.getByRole("img", { name: "NIFTY 500 heatmap: 3 stocks up, 3 down" });
  expect(map.querySelectorAll(".hm-tile")).toHaveLength(6);
  expect(map.querySelectorAll(".hm-sector")).toHaveLength(3);
  expect(within(map).getByText("RELIANCE")).toBeInTheDocument();
  expect(byTitle(map, "TCS +0.20%")).toBeTruthy();  // untraded stocks still get a box

  fireEvent.click(byTitle(map, "RELIANCE +7.71%"));
  expect(screen.getByText("RELIANCE Ltd · Oil & Gas")).toBeInTheDocument();
  expect(screen.getByText("₹900 Cr traded")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open details" }));
  expect(onOpenDetails).toHaveBeenCalledWith("RELIANCE");

  fireEvent.click(screen.getByRole("button", { name: "Equal" }));
  expect(screen.getByRole("button", { name: "Equal" })).toHaveAttribute("aria-pressed", "true");
});

test("NIFTY 500 is heatmap only, and a heatmap stock opens in the details view", async () => {
  const detail = { type: "success", index: "nifty", label: "NIFTY 50", marketOpen: true, stocks: [], sectors: [], message: "Loading live stock prices..." };
  const api = { heatmap: jest.fn(async () => heatmap()), load: jest.fn(async () => detail) };
  await act(async () => { render(<IndexStocks api={api} />); });
  expect(api.load).toHaveBeenCalledWith("nifty", expect.anything());

  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "NIFTY 500" })); });
  expect(api.heatmap).toHaveBeenLastCalledWith("nifty500", expect.anything());
  expect(screen.getByRole("button", { name: "Details" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Open details" })).not.toBeInTheDocument();

  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "SENSEX" })); });
  expect(api.heatmap).toHaveBeenLastCalledWith("sensex", expect.anything());
  expect(localStorage.getItem("utraders-index-stocks-view")).toBe("heatmap");
  fireEvent.click(byTitle(document, "INFY -1.31%"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Open details" })); });
  expect(api.load).toHaveBeenLastCalledWith("sensex", expect.anything());
  expect(localStorage.getItem("utraders-index-stocks-view")).toBe("details");
});
