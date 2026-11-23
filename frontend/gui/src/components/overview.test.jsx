import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import Overview from "./overview";
import { ThemeProvider } from "../theme";
import { makeBoardPreviewApi, makeBoardSnapshot } from "../boardFixtures";
import { decodeSnapshot } from "../boardData";
import { makeNewsPreviewApi } from "../newsFixtures";
import { makeStraddlePreviewApi } from "../straddleFixtures";
import { makeChainPayload, makeDecisionPayload } from "../overviewFixtures";

const chain = makeChainPayload();
const decision = makeDecisionPayload();

function makeApis(overrides = {}) {
  return {
    boardApi: makeBoardPreviewApi(),
    decisionApi: { decision: jest.fn(async () => decision) },
    oiApi: { expiries: jest.fn(async () => ({ expiries: ["2026-11-24"], recorded: ["2026-11-24"] })), liveChain: jest.fn(async () => chain), chain: jest.fn() },
    newsApi: makeNewsPreviewApi(),
    straddleApi: makeStraddlePreviewApi(),
    ...overrides,
  };
}
const renderHome = (apis = makeApis(), props = {}) => {
  render(<ThemeProvider><Overview {...apis} {...props} /></ThemeProvider>);
  return apis;
};
const tile = name => within(screen.getByRole("region", { name }));

test("Home puts every part of the app on one screen", async () => {
  renderHome();
  expect(screen.getByRole("heading", { name: "Market at a glance" })).toBeInTheDocument();
  await screen.findByText("Risky time. Better to wait.");
  const snapshot = decodeSnapshot(makeBoardSnapshot());

  // The index strip, with the decision's direction beside NIFTY.
  const strip = await screen.findByRole("region", { name: "Indices" });
  expect(within(strip).getByText("NIFTY 50")).toBeInTheDocument();
  expect(within(strip).getByText("Going down")).toBeInTheDocument();
  expect(within(strip).getByText("1.12")).toBeInTheDocument();   // NIFTY PCR

  // Synopsis: four boxes of four, the biggest gainer first.
  const synopsis = tile("Synopsis");
  const best = [...snapshot.stocks].sort((a, b) => b.pc - a.pc)[0];
  const priceUp = within(synopsis.getByRole("group", { name: "Price up" }));
  expect(priceUp.getAllByText(/^[A-Z&-]+$/)[0]).toHaveTextContent(best.sym);
  ["Price up", "Price down", "OI up", "OI down"].forEach(name => expect(synopsis.getByRole("group", { name })).toBeInTheDocument());

  // Option chain: five strikes centred on ATM.
  const optionChain = tile("Option chain");
  expect(await optionChain.findByText("25,450")).toBeInTheDocument();
  expect([...document.querySelectorAll("[data-strike]")].map(row => Number(row.dataset.strike))).toEqual([25350, 25400, 25450, 25500, 25550]);
  expect(document.querySelector('[data-strike="25450"]')).toHaveAttribute("aria-current", "true");
  expect(optionChain.getByText("LIVE")).toBeInTheDocument();
  expect(optionChain.getByText("0.94")).toBeInTheDocument();

  // Contributors by stock and by sector, from the board's NIFTY weights.
  expect(tile("Index contributors · Stocks").getByRole("list", { name: "Adding to NIFTY" })).toBeInTheDocument();
  expect(tile("Index contributors · Sectors").getAllByRole("listitem").length).toBeGreaterThan(3);

  // The rest of the app.
  expect(tile("Global markets").getByTitle("Global markets from TradingView")).toBeInTheDocument();
  expect(await tile("Latest news").findAllByRole("link")).not.toHaveLength(0);
  expect(tile("Index signals").getByText("Good time to trade.")).toBeInTheDocument();
  expect(await screen.findByTestId("home-straddle")).toHaveTextContent(/^\d[\d,]*\.\d{2}$/);
  expect(tile("Market breadth").getByRole("img", { name: /advancing/ })).toBeInTheDocument();
});

test("clicking a box or its open button opens that page, but links inside it do not", async () => {
  const onOpen = jest.fn(), onOpenStocks = jest.fn();
  renderHome(makeApis(), { onOpen, onOpenStocks });
  const synopsis = await screen.findByRole("region", { name: "Synopsis" });
  await within(synopsis).findByRole("group", { name: "Price up" });
  fireEvent.click(within(synopsis).getByRole("group", { name: "Price up" }));
  expect(onOpen).toHaveBeenLastCalledWith("money-flow");
  fireEvent.click(tile("Option chain").getByRole("button", { name: "Open OI Analysis" }));
  expect(onOpen).toHaveBeenLastCalledWith("oi-analysis");
  fireEvent.click(tile("Index signals").getByRole("button", { name: "Open Index Analysis" }));
  expect(onOpen).toHaveBeenLastCalledWith("index-analysis");
  fireEvent.click(tile("Straddle").getByRole("button", { name: "Open Equity" }));
  expect(onOpen).toHaveBeenLastCalledWith("equity");
  fireEvent.click(tile("Index contributors · Sectors").getByRole("button", { name: "Open Index Stocks" }));
  expect(onOpenStocks).toHaveBeenCalledWith("nifty");
  fireEvent.click(screen.getByRole("region", { name: "Indices" }));
  expect(onOpen).toHaveBeenLastCalledWith("market");

  onOpen.mockClear();
  const [headline] = await tile("Latest news").findAllByRole("link");
  fireEvent.click(headline);
  expect(onOpen).not.toHaveBeenCalled();
});

test("one source failing only empties its own box", async () => {
  const apis = makeApis({ oiApi: { expiries: jest.fn(async () => { throw new Error("OI data unavailable."); }), liveChain: jest.fn(), chain: jest.fn() } });
  renderHome(apis);
  expect(await tile("Option chain").findByText("OI data unavailable.")).toBeInTheDocument();
  expect(await tile("Index signals").findByText("Good time to trade.")).toBeInTheDocument();
  expect(await tile("Synopsis").findByRole("group", { name: "Price up" })).toBeInTheDocument();
});

test("a recorded chain is used when the live chain is not available", async () => {
  const oiApi = { expiries: jest.fn(async () => ({ expiries: ["2026-11-24"], recorded: ["2026-11-24"] })),
    liveChain: jest.fn(async () => ({ type: "success", live: false, message: "Market closed." })), chain: jest.fn(async () => ({ ...chain, live: undefined })) };
  renderHome(makeApis({ oiApi }));
  expect(await tile("Option chain").findByText("RECORDED")).toBeInTheDocument();
  expect(oiApi.chain).toHaveBeenCalledWith("nifty", "2026-11-24", 15, "atm", expect.anything());
});
