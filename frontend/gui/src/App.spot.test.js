import { render, screen, within } from "@testing-library/react";
import App from "./App";

const keys = ["nifty", "banknifty", "sensex"];
const months = ["current", "next", "far"];
const spots = [25000, 56000, 81000];
const response = (month = "current", differences = [125.5, -80.25, 0]) => ({
  type: "success", contractMonth: month, feedStatus: "live",
  symbols: Object.fromEntries(keys.map(key => [key, { symbol: key.toUpperCase() + month.toUpperCase() + "FUT", lotSize: 25 }])),
  spotPrices: Object.fromEntries(keys.map((key, i) => [key, spots[i]])),
  quotes: Object.fromEntries(keys.map((key, i) => [key, {
    last_price: spots[i] + differences[i], change: 1, receivedAt: Date.now(),
    ohlc: { open: spots[i], close: spots[i] - 20, high: spots[i] + 200, low: spots[i] - 100 },
    average_traded_price: spots[i], oi: 1000,
    total_buy_quantity: 1500, total_sell_quantity: 1000
  }]))
});

let app;
beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  app = new App({});
  app.state.loggedIn = true;
  app.state.settings.symbols = response().symbols;
  app.setState = (update, callback) => {
    app.state = { ...app.state, ...(typeof update === "function" ? update(app.state) : update) };
    if (callback) callback();
  };
  app.request = jest.fn(async () => response(app.state.settings.contractMonth));
  app.loadSnapshotHistory = jest.fn();
  app.loadSnapshotHeartbeat = jest.fn();
});
afterEach(() => {
  app.stopMarketData();
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const flush = () => jest.advanceTimersByTime(20);

test("saving columns updates only preferences without restarting the market feed", async () => {
  const stop = jest.spyOn(app, "stopMarketData");
  const settings = { ...app.state.settings };
  app.request.mockResolvedValue({ type: "success", marketColumns: ["spot", "netLots"] });
  await app.handleMarketColumnsSave(["spot", "netLots"]);
  expect(app.request).toHaveBeenCalledWith("settings/columns/", "POST", { marketColumns: ["spot", "netLots"] }, false, false, true);
  expect(app.state.settings).toEqual({ ...settings, marketColumns: ["spot", "netLots"] });
  expect(stop).not.toHaveBeenCalled();
});

test("failed column persistence leaves saved preferences untouched", async () => {
  app.state.settings.marketColumns = ["spot"];
  app.request.mockResolvedValue({ type: "NetworkError" });
  await expect(app.handleMarketColumnsSave(["futures"])).rejects.toThrow();
  expect(app.state.settings.marketColumns).toEqual(["spot"]);
});

test("an older settings response cannot replace a newly saved column selection", async () => {
  let resolveSettings;
  app.request.mockImplementationOnce(() => new Promise(resolve => { resolveSettings = resolve; }))
    .mockResolvedValueOnce({ type: "success", marketColumns: ["spot"] });
  const pending = app.getSettings();
  await app.handleMarketColumnsSave(["spot"]);
  resolveSettings({ type: "success", settings: { ...app.state.settings, marketColumns: ["futures"] } });
  await pending;
  expect(app.state.settings.marketColumns).toEqual(["spot"]);
});
const differenceCells = () => within(screen.getByRole("region", { name: "Index comparison" }))
  .getAllByRole("row").slice(1).map(row => within(row).getAllByRole("cell")[2]);

test.each(months)("shows all three spot/futures differences for %s without a broker connection", async month => {
  const websocket = jest.spyOn(global, "WebSocket");
  app.state.settings.contractMonth = month;
  const differences = [125.5, -80.25, 0].map(value => value * (months.indexOf(month) + 1));
  app.request.mockResolvedValue(response(month, differences));
  await app.startMarketData();
  flush();
  render(app.render());
  differences.forEach((value, i) => {
    expect(differenceCells()[i]).toHaveTextContent((value > 0 ? "+" : "") + value.toLocaleString("en-IN"));
  });
  expect(websocket).not.toHaveBeenCalled();
  expect(app.request.mock.calls.every(([route]) => route.startsWith("market-data/"))).toBe(true);
  expect(app.state.accessToken).toBeUndefined();
});

test("refreshes the difference when spot or futures changes", async () => {
  await app.startMarketData(); flush();
  const view = render(app.render());
  const updated = response("current", [100, -80.25, 0]);
  updated.spotPrices.nifty = 25025;
  app.applyMarketData(updated); flush();
  view.rerender(app.render());
  expect(differenceCells()[0]).toHaveTextContent("+75");
  updated.quotes.nifty.last_price = 24950;
  app.applyMarketData(updated); flush();
  view.rerender(app.render());
  expect(differenceCells()[0]).toHaveTextContent("-75");
  expect(app.state.niftyData.lot).toBe("20.00");
});

test.each([0, -1, null, undefined])("missing or invalid spot %s renders a dash", async price => {
  const data = response();
  data.spotPrices.nifty = price;
  app.request.mockResolvedValue(data);
  await app.startMarketData(); flush();
  render(app.render());
  expect(differenceCells()[0]).toHaveTextContent(/^\-$/);
});

test("network failure clears stale prices and polling automatically recovers", async () => {
  const poll = jest.spyOn(app, "pollMarketData");
  app.request.mockResolvedValueOnce(response()).mockResolvedValueOnce({ type: "NetworkError" }).mockResolvedValue(response());
  await app.startMarketData(); flush();
  expect(app.state.spotPrices.nifty).toBe(25000);
  jest.advanceTimersByTime(1000);
  await poll.mock.results[1].value; flush();
  expect(app.request).toHaveBeenCalledTimes(2);
  expect(app.state.spotPrices.nifty).toBeNull();
  expect(app.state.niftyData.symbol).toBeNull();
  jest.advanceTimersByTime(1000);
  await poll.mock.results[2].value; flush();
  expect(app.state.spotPrices.nifty).toBe(25000);
});

test("offline server clears all comparison values even if it returns old quotes", async () => {
  app.request.mockResolvedValue({ ...response(), feedStatus: "offline" });
  await app.startMarketData(); flush();
  render(app.render());
  differenceCells().forEach(cell => expect(cell).toHaveTextContent(/^\-$/));
  expect(screen.getByRole("status")).toHaveTextContent(/Reconnecting automatically/);
});

test("a late old-month response cannot overwrite the new month", async () => {
  let finishOld;
  app.request.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
  const oldRequest = app.startMarketData();
  app.stopMarketData();
  app.state.settings.contractMonth = "next";
  await app.startMarketData(); flush();
  finishOld(response("current"));
  await oldRequest; flush();
  expect(app.state.niftyData.symbol).toBe("NIFTYNEXTFUT");
});

test("logout aborts polling and ignores late responses", async () => {
  let finish;
  app.request.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = app.startMarketData();
  const signal = app.request.mock.calls[0][6];
  app.handleLogout();
  finish(response());
  await pending; flush();
  expect(signal.aborted).toBe(true);
  expect(app.state.spotPrices.nifty).toBeNull();
  expect(app.marketDataTimer).toBeNull();
});

test("session expiry stops polling", async () => {
  app.request.mockResolvedValue({ type: "TokenException" });
  await app.startMarketData();
  expect(app.state.loggedIn).toBe(false);
  expect(app.marketDataTimer).toBeNull();
});

test("month saves are serialized so the latest selection wins", async () => {
  const requests = [];
  app.request.mockImplementation((route, method, body) => {
    if (method === "POST") return new Promise(resolve => requests.push({ body, resolve }));
    return Promise.resolve(response(app.state.settings.contractMonth));
  });
  app.handleContractMonthChange("next");
  await Promise.resolve();
  app.handleContractMonthChange("far");
  expect(requests).toHaveLength(1);
  requests[0].resolve({ type: "success", settings: { ...requests[0].body } });
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(requests[1].body.contractMonth).toBe("far");
  requests[1].resolve({ type: "success", settings: { ...requests[1].body } });
  await app.settingsSaveQueue; flush();
  expect(app.state.settings.contractMonth).toBe("far");
});
