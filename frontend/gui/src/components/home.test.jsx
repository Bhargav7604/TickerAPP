import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Home, { countdown } from "./home";

const NOW = Date.UTC(2026, 9, 27, 9, 20) / 1000; // 14:50 IST
const card = (key, label, overrides = {}) => ({
  key, label, symbol: `${label}26NOVFUT`, price: 22540.5, change: { value: 85.4, pct: 0.38, since: "yesterday" },
  asOf: NOW, late: false, live: true,
  direction: { code: "up", label: "Going up", detail: "Futures up 0.40% in the last 30 minutes." },
  bigPlayers: { code: "buying", label: "Big players are buying", detail: "More put selling." },
  trap: null, light: { color: "green", label: "Good time to trade.", reasons: ["Price direction and big players agree."] },
  range: { low: 22150, high: 23100, spot: 22540, iv: 15, support: 22500, resistance: 23000, text: `${label} will most likely stay between 22,150 and 23,100 until expiry on 03 Nov (about a 2 in 3 chance).` },
  expiry: { date: "2026-11-03", isToday: false }, numbers: { pcr: 1.1 }, ...overrides,
});

function payload(overrides = {}) {
  return {
    cards: [
      card("nifty", "NIFTY", { expiry: { date: "2026-10-27", isToday: true },
        trap: { message: "Careful. This rise may not last. Don't chase it.", detail: "Big players are selling." },
        bigPlayers: { code: "selling", label: "Big players are selling", detail: "More call selling." },
        light: { color: "red", label: "Risky time. Better to wait.", reasons: ["Last hour of expiry: option prices can jump fast."] } }),
      card("banknifty", "BANKNIFTY", { light: { color: "yellow", label: "Unclear. Trade small.", reasons: ["The market is going nowhere."] },
        direction: { code: "flat", label: "Going nowhere", detail: "Flat." } }),
      card("sensex", "SENSEX", { late: true, live: false }),
    ],
    mustKnow: [{ level: "danger", text: "NIFTY options expire today. After 2:30 pm prices can jump very fast." },
               { level: "warning", text: "In F&O ban today (no new positions allowed): SAIL." }],
    calendar: { nifty: [{ date: "2026-10-27", label: "Today", thisWeek: true }], banknifty: [{ date: "2026-11-23", label: "Mon 23 Nov", thisWeek: false }], sensex: [{ date: "2026-10-29", label: "Thu 29 Oct", thisWeek: true }] },
    expiryToday: ["nifty"], marketOpen: true, lastHour: true, closesAt: NOW + 2400, now: NOW,
    disclaimer: "Utraders describes the market. It does not tell you to buy or sell.", ...overrides,
  };
}

async function renderHome(data = payload(), extra = {}) {
  const api = { decision: jest.fn(async () => data) };
  await act(async () => { render(<Home api={api} details={<h2>Full tables</h2>} {...extra} />); });
  return api;
}

beforeEach(() => localStorage.clear());

test("every card shows only the short summary until More details is opened", async () => {
  await renderHome();
  const nifty = screen.getByRole("article", { name: "NIFTY summary" });
  expect(within(nifty).getByText("Risky time. Better to wait.")).toBeInTheDocument();
  expect(within(nifty).getByRole("alert")).toHaveTextContent("Careful. This rise may not last. Don't chase it.");
  expect(within(nifty).getByText("Expires today")).toBeInTheDocument();
  const bank = screen.getByRole("article", { name: "BANKNIFTY summary" });
  expect(within(bank).getByText("Going nowhere")).toBeInTheDocument();
  expect(within(bank).getByText("Unclear. Trade small.")).toBeInTheDocument();
  // Range and levels stay behind More details on all three cards.
  ["NIFTY", "BANKNIFTY", "SENSEX"].forEach(label => {
    const summary = screen.getByRole("article", { name: `${label} summary` });
    expect(within(summary).queryByText(/stay between/)).not.toBeInTheDocument();
    expect(within(summary).queryByText(/Market often stops/)).not.toBeInTheDocument();
    expect(within(summary).getByRole("button", { name: /More details/ })).toHaveAttribute("aria-expanded", "false");
  });
  fireEvent.click(within(bank).getByRole("button", { name: /More details/ }));
  expect(within(bank).getByText(/stay between 22,150 and 23,100/)).toBeInTheDocument();
  expect(within(bank).getByText(/Market often stops falling near/)).toBeInTheDocument();
  expect(within(nifty).queryByText(/stay between/)).not.toBeInTheDocument();
  expect(within(screen.getByRole("article", { name: "SENSEX summary" })).getByText(/Data is late/)).toBeInTheDocument();
});

test("expiry day mode shows the banner, countdown and last-hour warning", async () => {
  await renderHome();
  expect(screen.getByText("EXPIRY DAY")).toBeInTheDocument();
  expect(screen.getByText(/Market closes in/)).toBeInTheDocument();
  expect(screen.getByText("Last hour of expiry. Prices can jump fast. Keep your exit ready or stay out.")).toBeInTheDocument();
  expect(countdown(2400)).toBe("0h 40m 00s");
  expect(countdown(-5)).toBe("closed");
});

test("must-know box, expiry calendar and disclaimer", async () => {
  await renderHome();
  const box = screen.getByRole("region", { name: "Must know today" });
  expect(within(box).getAllByRole("listitem")).toHaveLength(2);
  expect(within(box).getByText(/SAIL/)).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Expiry calendar" })).getByText("Today")).toHaveClass("is-today");
  expect(screen.getByText(/does not tell you to buy or sell/)).toBeInTheDocument();
});

test("card details open on request and the market desk is always on the page", async () => {
  await renderHome();
  const nifty = screen.getByRole("article", { name: "NIFTY summary" });
  expect(within(nifty).queryByText("Why this light")).not.toBeInTheDocument();
  fireEvent.click(within(nifty).getByRole("button", { name: /More details/ }));
  expect(within(nifty).getByText("Why this light")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Full tables" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /full market tables/ })).not.toBeInTheDocument();
});

test("normal days have no expiry banner", async () => {
  await renderHome(payload({ expiryToday: [], lastHour: false }));
  expect(screen.queryByText("EXPIRY DAY")).not.toBeInTheDocument();
  expect(screen.queryByText(/Last hour of expiry/)).not.toBeInTheDocument();
});

test("the latest swing alert shows as a quiet strip, not a popup, and jumps to the swing list", async () => {
  const latestSwing = { indexKey: "sensex", indexName: "Sensex", symbol: "SENSEX26OCTFUT", time: Date.now(),
    previousNetLots: -50, currentNetLots: 74, swingLots: 124, threshold: 40, indexLevel: 73300 };
  await renderHome(payload({ expiryToday: [], lastHour: false }), { latestSwing });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  const strip = screen.getByRole("region", { name: "Latest swing alert" });
  expect(strip).toHaveTextContent("SENSEX ▲ +124 lots");
  expect(strip).toHaveTextContent("▼ -50 → ▲ +74 · SENSEX26OCTFUT");
  const panel = document.createElement("div");
  panel.className = "scan-activity";
  panel.scrollIntoView = jest.fn();
  document.body.appendChild(panel);
  fireEvent.click(within(strip).getByRole("button", { name: "See all swing alerts" }));
  expect(panel.scrollIntoView).toHaveBeenCalled();
  panel.remove();
});

test("yesterday's swing alert is not shown", async () => {
  const latestSwing = { indexKey: "nifty", indexName: "Nifty", symbol: "NIFTY26OCTFUT", time: Date.now() - 86400000,
    previousNetLots: 0, currentNetLots: 500, swingLots: 500 };
  await renderHome(payload({ expiryToday: [], lastHour: false }), { latestSwing });
  expect(screen.queryByRole("region", { name: "Latest swing alert" })).not.toBeInTheDocument();
});

test("each card can open its index's stocks", async () => {
  const onOpenStocks = jest.fn();
  await renderHome(payload({ expiryToday: [], lastHour: false }), { onOpenStocks });
  const bank = screen.getByRole("article", { name: "BANKNIFTY summary" });
  // See stocks is on the card itself, without opening More details.
  expect(within(bank).getByRole("button", { name: /More details/ })).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(within(bank).getByRole("button", { name: /See stocks/ }));
  expect(onOpenStocks).toHaveBeenCalledWith("banknifty");
});

test("returning to the tab reloads straight away so the light is never left stale", async () => {
  const api = await renderHome(payload({ expiryToday: [], lastHour: false }));
  expect(api.decision).toHaveBeenCalledTimes(1);
  const visibility = jest.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(api.decision).toHaveBeenCalledTimes(2);
  visibility.mockRestore();
});

test("sector contribution splits NIFTY's points into sectors pushing it up and pulling it down", async () => {
  const contribution = jest.fn(async () => ({
    type: "success", index: "nifty", label: "NIFTY 50", marketOpen: true, indexMove: 25, explained: 25, weightsOn: "2026-11-13", asOf: NOW,
    sectors: [
      { name: "Banking", points: 20, stocks: [{ symbol: "HDFCBANK", points: 20, ltp: 1010, prevClose: 1000, change: 10, changePct: 1, weightPct: 8.33 }] },
      { name: "IT", points: 10, stocks: [{ symbol: "INFY", points: 30, ltp: 1520, change: 20, changePct: 1.33, weightPct: 9.38 },
        { symbol: "TCS", points: -20, ltp: 3450, change: -50, changePct: -1.43, weightPct: 5.83 }] },
      { name: "FMCG", points: 0, stocks: [] },
      { name: "NBFC & Finance", points: -5, stocks: [{ symbol: "BAJFINANCE", points: -5, changePct: -1.11 }] },
    ],
  }));
  const api = { decision: jest.fn(async () => payload({ expiryToday: [], lastHour: false })), contribution };
  await act(async () => { render(<Home api={api} details={<h2>Full tables</h2>} />); });
  expect(contribution).toHaveBeenCalledWith("nifty", expect.anything());
  const panel = screen.getByRole("region", { name: "Sector contribution" });
  expect(within(panel).getByText("NIFTY ▲ +25.0 pts")).toBeInTheDocument();
  const up = within(panel).getByRole("heading", { name: "Pushing NIFTY up" }).parentElement;
  const down = within(panel).getByRole("heading", { name: "Pulling NIFTY down" }).parentElement;
  expect(within(up).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["Banking +20.0 NIFTY points", "IT +10.0 NIFTY points"]);
  expect(within(down).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["NBFC & Finance -5.0 NIFTY points"]);
  expect(within(panel).getByText("No change: FMCG")).toBeInTheDocument();
  expect(within(panel).getByText(/Sectors add up to \+25\.0 of NIFTY's \+25\.0 points/)).toBeInTheDocument();
  expect(within(panel).queryByRole("table", { name: "IT stocks" })).not.toBeInTheDocument();
  fireEvent.click(within(up).getByRole("button", { name: "IT +10.0 NIFTY points" }));
  const table = within(panel).getByRole("table", { name: "IT stocks" });
  expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Stock", "Price ₹", "Change ₹ (%)", "Weight", "NIFTY pts"]);
  const rows = within(table).getAllByRole("row").slice(1).map(row => within(row).getAllByRole("cell").map(cell => cell.textContent));
  expect(rows).toEqual([["INFY", "1,520.00", "▲\u00a0+20.00 (+1.33%)", "9.4%", "▲\u00a0+30.0 pts"], ["TCS", "3,450.00", "▼\u00a0-50.00 (-1.43%)", "5.8%", "▼\u00a0-20.0 pts"]]);
  expect(within(panel).getByText(/NIFTY pts are index points, not the stock's price: INFY moved \+₹20\.00 \(\+1\.33%\) and is 9\.4% of NIFTY, so it moved NIFTY by \+30\.0 points\./)).toBeInTheDocument();
});

test("Home without the contribution API shows no sector panel", async () => {
  await renderHome(payload({ expiryToday: [], lastHour: false }));
  expect(screen.queryByRole("region", { name: "Sector contribution" })).not.toBeInTheDocument();
});


test("the sector panel says when the weights were refitted", () => {
  const { weightsNote } = require("./sectorContribution");
  const now = new Date("2026-11-16T07:30:00Z"); // 13:00 IST
  expect(weightsNote({ weightsOn: "2026-11-16", weightsAt: "2026-11-16T12:45:35+05:30" }, now)).toBe(" · weights updated 12:45");
  expect(weightsNote({ weightsOn: "2026-11-13", weightsAt: "2026-11-13T15:15:35+05:30" }, now)).toBe(" · weights from 13 Nov");
  expect(weightsNote({ weightsOn: "2026-11-13" }, now)).toBe(" · weights from 13 Nov");
  expect(weightsNote(null, now)).toBe("");
});

test("the Commodity market shows commodities in the same cards", async () => {
  const keys = [["crudeoil", "CRUDE OIL"], ["naturalgas", "NATURAL GAS"], ["gold", "GOLD"], ["silver", "SILVER"], ["copper", "COPPER"], ["zinc", "ZINC"]];
  const commodity = payload({
    cards: keys.map(([key, label]) => card(key, label, { range: null, numbers: { netLots: 600, pcr: null } })),
    calendar: Object.fromEntries(keys.map(([key]) => [key, [{ date: "2026-12-18", label: "Fri 18 Dec", thisWeek: false }]])),
    mustKnow: [{ level: "info", text: "US markets open at 20:00 IST; crude oil, gold and silver often move sharply then. MCX closes at 23:55." }],
    expiryToday: [], lastHour: false, market: "commodity",
  });
  await renderHome(commodity, { market: "commodity" });
  const tiles = screen.getByRole("region", { name: "Commodity summaries" });
  expect(within(tiles).getAllByRole("article").map(article => article.getAttribute("aria-label"))).toEqual(keys.map(([, label]) => `${label} summary`));
  expect(screen.getByText(/US markets open at 20:00 IST/)).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Expiry calendar" })).getByText("CRUDE OIL")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Sector contribution" })).not.toBeInTheDocument();
});
