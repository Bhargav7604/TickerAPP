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

test("three plain-language cards with light, direction, big players and expected range", async () => {
  await renderHome();
  const nifty = screen.getByRole("article", { name: "NIFTY summary" });
  expect(within(nifty).getByText("Risky time. Better to wait.")).toBeInTheDocument();
  expect(within(nifty).getByRole("alert")).toHaveTextContent("Careful. This rise may not last. Don't chase it.");
  expect(within(nifty).getByText("Expires today")).toBeInTheDocument();
  const bank = screen.getByRole("article", { name: "BANKNIFTY summary" });
  expect(within(bank).getByText("Going nowhere")).toBeInTheDocument();
  expect(within(bank).getByText("Unclear. Trade small.")).toBeInTheDocument();
  expect(within(bank).getByText(/stay between 22,150 and 23,100/)).toBeInTheDocument();
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

test("details stay hidden until the trader asks", async () => {
  await renderHome();
  const nifty = screen.getByRole("article", { name: "NIFTY summary" });
  expect(within(nifty).queryByText("Why this light")).not.toBeInTheDocument();
  fireEvent.click(within(nifty).getByRole("button", { name: /More details/ }));
  expect(within(nifty).getByText("Why this light")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Full tables" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /full market tables/ }));
  expect(screen.getByRole("heading", { name: "Full tables" })).toBeInTheDocument();
});

test("normal days have no expiry banner", async () => {
  await renderHome(payload({ expiryToday: [], lastHour: false }));
  expect(screen.queryByText("EXPIRY DAY")).not.toBeInTheDocument();
  expect(screen.queryByText(/Last hour of expiry/)).not.toBeInTheDocument();
});

test("the latest swing alert shows as a quiet strip, not a popup, and opens the full tables", async () => {
  const latestSwing = { indexKey: "sensex", indexName: "Sensex", symbol: "SENSEX26OCTFUT", time: Date.now(),
    previousNetLots: -50, currentNetLots: 74, swingLots: 124, threshold: 40, indexLevel: 73300 };
  await renderHome(payload({ expiryToday: [], lastHour: false }), { latestSwing });
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  const strip = screen.getByRole("region", { name: "Latest swing alert" });
  expect(strip).toHaveTextContent("SENSEX +124 lots");
  expect(strip).toHaveTextContent("-50 → +74 · SENSEX26OCTFUT");
  fireEvent.click(within(strip).getByRole("button", { name: "See all swing alerts" }));
  expect(screen.getByRole("heading", { name: "Full tables" })).toBeInTheDocument();
  expect(localStorage.getItem("utraders-home-tables")).toBe("open");
});

test("yesterday's swing alert is not shown", async () => {
  const latestSwing = { indexKey: "nifty", indexName: "Nifty", symbol: "NIFTY26OCTFUT", time: Date.now() - 86400000,
    previousNetLots: 0, currentNetLots: 500, swingLots: 500 };
  await renderHome(payload({ expiryToday: [], lastHour: false }), { latestSwing });
  expect(screen.queryByRole("region", { name: "Latest swing alert" })).not.toBeInTheDocument();
});
