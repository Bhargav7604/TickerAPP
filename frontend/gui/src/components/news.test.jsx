import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createChart } from "lightweight-charts";
import News from "./news";
import { makeBoardSnapshot } from "../boardFixtures";
import { makeNewsPayload } from "../newsFixtures";

jest.mock("lightweight-charts", () => ({ createChart: jest.fn(), LineSeries: "line", HistogramSeries: "histogram", ColorType: { Solid: "solid" } }));
beforeEach(() => {
  createChart.mockImplementation(() => ({ addSeries: () => ({ setData: jest.fn(), applyOptions: jest.fn(), update: jest.fn() }),
    timeScale: () => ({ fitContent: jest.fn(), setVisibleLogicalRange: jest.fn() }), applyOptions: jest.fn(), subscribeCrosshairMove: jest.fn(), remove: jest.fn() }));
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-23T14:31:00+05:30"));
});
afterEach(() => jest.restoreAllMocks());

const boardApi = () => {
  const snapshot = makeBoardSnapshot();
  return { snapshot: jest.fn(async () => snapshot), scanner: jest.fn(), candles: jest.fn(async () => ({ candles: [], message: "" })) };
};

async function renderPage(load = jest.fn(async () => makeNewsPayload())) {
  await act(async () => { render(<News api={{ load }} boardApi={boardApi()} />); });
  return load;
}
const newsItems = () => within(screen.getByRole("list", { name: "Market news" })).queryAllByRole("listitem");
const filingItems = () => within(screen.getByRole("list", { name: "Company filings" })).queryAllByRole("listitem");
const titles = () => newsItems().map(item => item.querySelector("a").firstChild.textContent);
const companies = () => filingItems().map(item => item.querySelector("span").textContent);
const choose = (label, value) => {
  const select = document.querySelector(`[role="combobox"][aria-label="${label}"]`);
  fireEvent.change(select.parentElement.querySelector("input"), { target: { value } });
};
const optionsOf = label => document.querySelector(`[role="combobox"][aria-label="${label}"]`).textContent;

test("stories show source, age and their stocks with the live move, and open on the publisher's site", async () => {
  await renderPage();
  expect(screen.getByRole("heading", { name: "News" })).toBeInTheDocument();
  expect(screen.getByText(/Today: 4 stories · 5 filings · updated 14:30 IST/)).toBeInTheDocument();
  expect(titles()).toEqual([
    "Tata Steel dips 7% as APL Apollo tumbles on ₹28,000 crore deal", "TCS vs Infosys: why Indian IT stocks are rising despite the global AI sell-off",
    "IT holds firm as banks and metals drag Nifty lower", "HDFC Bank shares, Bank Nifty retreat sharply from record highs",
    "Rupee retreats from a seven-month high on corporate dollar buying",
  ]);
  const first = newsItems()[0];
  expect(first).toHaveTextContent("Economic Times · Markets · 26 min ago");
  expect(newsItems()[4]).toHaveTextContent("Yesterday 18:30");
  const link = within(first).getByRole("link");
  expect(link).toHaveAttribute("href", "https://news.example.com/tata-steel-deal");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(first.querySelector("img")).toHaveAttribute("referrerpolicy", "no-referrer");
  const chip = first.querySelector('[data-sym="TATASTEEL"]');
  expect(chip.textContent).toMatch(/^TATASTEELF&O[▲▼] [+-]\d+\.\d\d%$/);
  expect(screen.getByText("Business Standard is not responding; showing the stories fetched earlier.")).toBeInTheDocument();
});

test("filings start with NIFTY 500 and F&O companies, and filter by company scope and type", async () => {
  await renderPage();
  expect(companies()).toEqual(["Infosys Limited", "HDFC Bank Limited", "Tata Steel Limited"]);
  const tata = filingItems()[2];
  expect(tata).toHaveTextContent("09:05");
  expect(tata).toHaveTextContent("Deals & capital");
  expect(within(tata).getByRole("link", { name: "Open filing (PDF)" })).toHaveAttribute("href", "https://nsearchives.nseindia.com/corporate/sample-2.pdf");

  fireEvent.click(screen.getByRole("button", { name: "All companies" }));
  expect(companies()).toEqual(["Dalmia Bharat Limited", "Infosys Limited", "Railtel Corporation Of India Limited", "HDFC Bank Limited", "Tata Steel Limited"]);
  expect(optionsOf("Filing type")).toBe("All types (5)");
  choose("Filing type", "orders");
  expect(companies()).toEqual(["Railtel Corporation Of India Limited"]);
  expect(optionsOf("Filing type")).toBe("Orders (1)");
});

test("a stock chip narrows both lists to that stock, and search matches words anywhere", async () => {
  await renderPage();
  const trending = within(screen.getByRole("region", { name: "In the news today" }));
  // Each named twice today (a story and a filing) ranks above TCS (one story); ties go alphabetically.
  expect(trending.getAllByRole("button").map(button => button.dataset.sym)).toEqual(["HDFCBANK", "INFY", "TATASTEEL", "TCS"]);
  expect(trending.getAllByRole("button")[2]).toHaveTextContent("· 2");
  fireEvent.click(trending.getAllByRole("button")[2]);
  expect(screen.getByRole("status")).toHaveTextContent("Showing TATASTEEL · Tata Steel Ltd.");
  expect(titles()).toEqual(["Tata Steel dips 7% as APL Apollo tumbles on ₹28,000 crore deal"]);
  expect(companies()).toEqual(["Tata Steel Limited"]);
  expect(screen.getByRole("button", { name: "Open stock card" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show all" }));
  expect(newsItems()).toHaveLength(5);

  fireEvent.change(screen.getByRole("textbox", { name: "Search news" }), { target: { value: "infosys" } });
  expect(titles()).toEqual(["TCS vs Infosys: why Indian IT stocks are rising despite the global AI sell-off"]);
  expect(companies()).toEqual(["Infosys Limited"]);
  fireEvent.change(screen.getByRole("textbox", { name: "Search news" }), { target: { value: "nothing like this" } });
  expect(screen.getByText("No stories match.")).toBeInTheDocument();
  expect(screen.getByText("No filings match.")).toBeInTheDocument();
});

test("the source filter keeps one publisher", async () => {
  await renderPage();
  choose("News source", "Mint");
  expect(titles()).toEqual(["TCS vs Infosys: why Indian IT stocks are rising despite the global AI sell-off"]);
});

test("a failed load says so", async () => {
  await renderPage(jest.fn(async () => { throw new Error("News is unavailable right now."); }));
  expect(screen.getByRole("alert")).toHaveTextContent("News is unavailable right now.");
  expect(screen.queryByRole("list", { name: "Market news" })).not.toBeInTheDocument();
});
