import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import TraderDesk from "./traderDesk";

const overview = (overrides = {}) => ({
  profile: { capital: 200000, riskPct: 1, monthlyLossLimit: 10000, practiceMode: true, practiceBalance: 100000, language: "en", telegramLinked: false, mentorLink: null },
  licence: { level: 0, name: "Learner", text: "3 of 20 practice trades done.", realAllowed: false, maxLots: null },
  coolingOff: { active: false }, checkin: { done: true, ok: true, text: "You are calm and rested." },
  dangerTimes: { times: [], now: null }, emotionCost: { text: "This month no losses were tagged." }, lessons: { lessons: [], totalSaved: 0 },
  monthPnl: 0, openTrades: [], recentTrades: [], optionCost: null, expiryLevels: {}, cards: [],
  calendar: { nifty: [{ date: "2026-11-03", label: "Tue 03 Nov" }], banknifty: [], sensex: [] },
  disclaimer: "Utraders describes the market. It does not tell you to buy or sell.", ...overrides,
});

const plan = {
  trade: { entry: 120, symbol: "NIFTY26N0322600CE" },
  checklist: { ready: false, verdict: "Not ready. Take a 30-minute break.", checks: [
    { name: "Market", ok: true, text: "Price direction and big players agree." }, { name: "News", ok: true, text: "No big news." },
    { name: "Money", ok: true, text: "Your money guard is set." }, { name: "Mind", ok: false, text: "You lost 2 times today. Take a 30-minute break." }] },
  warnings: ["You're adding money to a losing trade."], dangerNow: "You often lose on Tuesdays between 2-3 pm. It is 2:10 pm now. Be careful.",
  sizing: { lots: 1, text: "Up to 1 lot. If the stop is hit you lose about ₹2,340 (1% of your money).", warning: "3 lots could lose ₹7,020, which is 3.5% of your money. That is too much risk.", stop: 84, stopSuggested: true },
  breakEven: { text: "NIFTY must rise 120 points (0.5%) before expiry on 03 Nov to make money. Chance about 22%. That looks unlikely." },
  lottery: "Lottery ticket. Very likely to become zero by expiry.", timeLoss: "This option loses about ₹117 every hour for your 3 lots, even if the market doesn't move.",
  whatIf: [{ label: "If the market falls 1%", pnl: -5000 }, { label: "If option prices drop after the news", pnl: -1200 }],
};

function makeApi(data = overview()) {
  return {
    overview: jest.fn(async () => data), plan: jest.fn(async () => plan), addTrade: jest.fn(async () => ({ trade: {}, warnings: [] })),
    checkin: jest.fn(async () => ({ ok: true })), closeTrade: jest.fn(async () => ({ trade: {}, lesson: { text: "The light was red. Waiting would have saved ₹500." } })),
    saveProfile: jest.fn(async () => ({})), mentorLink: jest.fn(async () => ({})),
    alerts: jest.fn(async () => ({ alerts: [{ id: 1, time: 1792650000, index: "nifty", strength: "strong", status: "confirmed", message: "NIFTY is rising and big players agree.", price: 22600, outcome: "right" }],
      reportCard: { hitRate: 75, text: "October: 3 of 4 alerts were right.", byStrength: { strong: { right: 2, wrong: 1, pending: 0 }, medium: { right: 1, wrong: 0, pending: 0 }, weak: { right: 0, wrong: 0, pending: 0 } } },
      record: { intact: true, count: 4 } })),
    replay: jest.fn(async () => ({ date: "2026-10-23", days: ["2026-10-23"], alerts: [], indexes: { nifty: { prices: [{ time: 1, price: 100, netLots: 5 }, { time: 2, price: 101, netLots: 6 }], oi: [] }, banknifty: { prices: [], oi: [] }, sensex: { prices: [], oi: [] } } })),
    expiryReport: jest.fn(async () => ({ market: { text: "Opened at 22,600." }, alerts: { text: "2 alerts." }, you: { text: "You did not trade." } })),
  };
}

async function renderDesk(api = makeApi()) {
  await act(async () => { render(<TraderDesk api={api} />); });
  return api;
}

test("plan a trade shows the four-light checklist, money guard and option checks", async () => {
  const api = await renderDesk();
  expect(screen.getByText(/Practice money/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Strike"), { target: { value: "22600" } });
  fireEvent.change(screen.getByLabelText("Lots"), { target: { value: "3" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check this trade" })); });
  expect(api.plan).toHaveBeenCalledWith(expect.objectContaining({ index: "nifty", expiry: "2026-11-03", instrument: "CE", strike: "22600", lots: "3" }));
  expect(screen.getByText("Not ready. Take a 30-minute break.")).toBeInTheDocument();
  expect(within(screen.getByLabelText("Pre-trade checklist")).getAllByRole("listitem")).toHaveLength(4);
  expect(screen.getByText(/too much risk/)).toBeInTheDocument();
  expect(screen.getByText(/That looks unlikely/)).toBeInTheDocument();
  expect(screen.getByText(/Lottery ticket/)).toBeInTheDocument();
  expect(screen.getByText(/You often lose on Tuesdays/)).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Add to my trade list \(practice money\)/ })); });
  expect(api.addTrade).toHaveBeenCalled();
});

test("morning check-in appears until answered", async () => {
  const api = await renderDesk(makeApi(overview({ checkin: { done: false, ok: false, text: "Answer the three quick questions first." } })));
  const box = screen.getByRole("region", { name: "Morning check-in" });
  const save = within(box).getByRole("button", { name: "Save answers" });
  expect(save).toBeDisabled();
  ["Did you sleep well?", "Are you upset about anything?", "Are you trying to win back a loss?"].forEach((question, index) =>
    fireEvent.click(within(within(box).getByRole("group", { name: question })).getByRole("button", { name: index === 0 ? "Yes" : "No" })));
  await act(async () => { fireEvent.click(save); });
  expect(api.checkin).toHaveBeenCalledWith({ sleptWell: true, upset: false, chasingLoss: false });
});

test("open trades show protect-your-profit and closing shows the plan lesson", async () => {
  const api = await renderDesk(makeApi(overview({ openTrades: [{ id: 7, symbol: "NIFTY26NOVFUT", side: "buy", lots: 1, entry: 22500, stop: 22400, current: 22600, practice: true,
    protect: { text: "You are up ₹6,500. An exit at 22,566.67 would keep at least ₹4,333." }, stockExpiry: null }] })));
  fireEvent.click(screen.getByRole("tab", { name: "My trades" }));
  expect(screen.getByText(/would keep at least/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Exit price for NIFTY26NOVFUT"), { target: { value: "22450" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Close trade" })); });
  expect(api.closeTrade).toHaveBeenCalledWith(7, "22450");
  expect(screen.getByText(/Waiting would have saved ₹500/)).toBeInTheDocument();
});

test("alerts tab shows the report card and locked record", async () => {
  await renderDesk();
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Alerts" })); });
  expect(screen.getByText("75%")).toBeInTheDocument();
  expect(screen.getByText("Record intact")).toBeInTheDocument();
  expect(screen.getByText(/NIFTY is rising and big players agree/)).toBeInTheDocument();
});

test("replay, expiry report and coach tabs render", async () => {
  await renderDesk();
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Replay" })); });
  expect(screen.getByRole("img", { name: "Price through the day" })).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Expiry report" })); });
  expect(screen.getByText("Opened at 22,600.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "Coach" }));
  expect(screen.getByText("Learner's licence")).toBeInTheDocument();
});

test("my money tab saves the money guard and creates a mentor link", async () => {
  const api = await renderDesk();
  fireEvent.click(screen.getByRole("tab", { name: "My money" }));
  fireEvent.change(screen.getByLabelText("Trading money (₹)"), { target: { value: "300000" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
  expect(api.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ capital: "300000" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create mentor link" })); });
  expect(api.mentorLink).toHaveBeenCalledWith(false);
});
