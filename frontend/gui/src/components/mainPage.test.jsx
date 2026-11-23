import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import MainPage from "./mainPage";

jest.mock("./dashboard", () => ({ __esModule: true, default: () => <h1>Index dashboard</h1> }));
jest.mock("./home", () => ({ __esModule: true, default: ({ api, details, onOpenStocks, market }) => <div>
  <p>Market: {market}</p>
  <button onClick={() => api.decision()}>Load cards</button>
  {details}{onOpenStocks && <button onClick={() => onOpenStocks("sensex")}>See SENSEX stocks</button>}</div> }));
jest.mock("./commodityDetails", () => ({ __esModule: true, default: ({ api }) => <h2>Commodity details / {api.name}</h2> }));
jest.mock("./indexStocks", () => ({ __esModule: true, default: ({ api }) => <h1>Index Stocks / {api.name}</h1> }));
jest.mock("./settings", () => ({ __esModule: true, default: () => <h1>Settings</h1> }));
jest.mock("./equity", () => ({ __esModule: true, default: ({ indexOptions, api }) => <h1>{indexOptions ? "Index Options" : "Equity"} / {api.name}</h1> }));
jest.mock("./oiAnalysis", () => ({ __esModule: true, default: ({ api }) => <h1>OI Analysis / {api.name}</h1> }));
jest.mock("./liveDashboard", () => ({ __esModule: true, default: ({ api }) => <h1>Dashboard / {api.name}</h1> }));
jest.mock("./marketPage", () => ({ __esModule: true, default: ({ api }) => <h1>Market / {api.name}</h1> }));
jest.mock("./moneyFlow", () => ({ __esModule: true, default: ({ api }) => <h1>Money Flow / {api.name}</h1> }));
jest.mock("./intraday", () => ({ __esModule: true, default: ({ api }) => <h1>Intraday / {api.name}</h1> }));
jest.mock("./tools", () => ({ __esModule: true, default: ({ api }) => <h1>Tools / {api.name}</h1> }));
jest.mock("./marketHolidays", () => ({ __esModule: true, default: () => <h1>Market Holidays page</h1> }));
jest.mock("./news", () => ({ __esModule: true, default: ({ api, boardApi }) => <h1>News / {api.name} / {boardApi.name}</h1> }));

afterEach(() => { window.history.replaceState(null, "", "/"); localStorage.removeItem("utraders-market"); });

const openMenu = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Open menu" }));
  return within(await screen.findByRole("navigation", { name: "Main navigation" }));
};

test("Index Options deep link and burger menu navigation keep the APIs separate", async () => {
  window.history.replaceState(null, "", "/#index-options");
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} />);
  expect(await screen.findByRole("heading", { name: "Index Options / indices" })).toBeInTheDocument();
  let nav = await openMenu();
  expect(nav.getByRole("button", { name: "Index Options" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(nav.getByRole("button", { name: "Equity", exact: true }));
  expect(await screen.findByRole("heading", { name: "Equity / stocks" })).toBeInTheDocument();
  nav = await openMenu();
  fireEvent.click(nav.getByRole("button", { name: "Home", exact: true }));
  expect(await screen.findByRole("heading", { name: "Index dashboard" })).toBeInTheDocument();
});

test("the page links live in the burger menu, which closes after choosing or with Escape", async () => {
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} />);
  expect(screen.queryByRole("navigation", { name: "Main navigation" })).not.toBeInTheDocument();
  const nav = await openMenu();
  expect(nav.getAllByRole("button").map(item => item.getAttribute("aria-label"))).toEqual(["Home", "Market", "News", "Money Flow", "Intraday", "Dashboard", "Index Stocks", "Equity", "Index Options", "OI Analysis", "Tools", "Market Holidays", "My Trading", "Settings"]);
  expect(within(screen.getByRole("dialog", { name: "Menu" })).getByText("demo")).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Menu" }), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("navigation", { name: "Main navigation" })).not.toBeInTheDocument());
  const again = await openMenu();
  fireEvent.click(again.getByRole("button", { name: "Settings" }));
  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Main navigation" })).not.toBeInTheDocument();
});

test("the burger menu can log out", async () => {
  const handleLogout = jest.fn();
  render(<MainPage username="demo" handleLogout={handleLogout} equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} />);
  await openMenu();
  fireEvent.click(within(screen.getByRole("dialog", { name: "Menu" })).getByRole("button", { name: "Account menu" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Log out" }));
  expect(handleLogout).toHaveBeenCalledTimes(1);
});

test("the menu search narrows the pages and Enter opens the first match", async () => {
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} oiApi={{ name: "oi" }} />);
  const nav = await openMenu();
  const search = within(screen.getByRole("dialog", { name: "Menu" })).getByRole("textbox", { name: "Search pages" });
  fireEvent.change(search, { target: { value: "analysis" } });
  expect(nav.getAllByRole("button").map(item => item.getAttribute("aria-label"))).toEqual(["OI Analysis"]);
  fireEvent.change(search, { target: { value: "zzz" } });
  expect(nav.getByText("No page found")).toBeInTheDocument();
  fireEvent.change(search, { target: { value: "analysis" } });
  fireEvent.keyDown(search, { key: "Enter" });
  expect(await screen.findByRole("heading", { name: "OI Analysis / oi" })).toBeInTheDocument();
});

test("the phone bar keeps five pages and More opens the full menu", async () => {
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} boardApi={{ name: "board" }} />);
  const nav = within(screen.getByRole("navigation", { name: "Mobile section navigation" }));
  expect(nav.getAllByRole("button").map(item => item.textContent)).toEqual(["Home", "Market", "Flow", "Intraday", "OI", "More"]);
  fireEvent.click(nav.getByRole("button", { name: "Flow", exact: true }));
  expect(await screen.findByRole("heading", { name: "Money Flow / board" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#money-flow");
  fireEvent.click(nav.getByRole("button", { name: "More pages" }));
  const menu = within(await screen.findByRole("navigation", { name: "Main navigation" }));
  fireEvent.click(menu.getByRole("button", { name: "Index Options" }));
  expect(await screen.findByRole("heading", { name: "Index Options / indices" })).toBeInTheDocument();
  expect(nav.getByRole("button", { name: "More pages" })).toHaveAttribute("aria-current", "page");
});

test("Market, Intraday and Tools open from the menu and by deep link", async () => {
  window.history.replaceState(null, "", "/#tools");
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} boardApi={{ name: "board" }} />);
  expect(await screen.findByRole("heading", { name: "Tools / board" })).toBeInTheDocument();
  fireEvent.click((await openMenu()).getByRole("button", { name: "Market" }));
  expect(await screen.findByRole("heading", { name: "Market / board" })).toBeInTheDocument();
  fireEvent.click((await openMenu()).getByRole("button", { name: "Intraday" }));
  expect(await screen.findByRole("heading", { name: "Intraday / board" })).toBeInTheDocument();
});

test("News opens by deep link with its own feed and the board for live prices", async () => {
  window.history.replaceState(null, "", "/#news");
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} boardApi={{ name: "board" }} newsApi={{ name: "feeds" }} />);
  expect(await screen.findByRole("heading", { name: "News / feeds / board" })).toBeInTheDocument();
  expect((await openMenu()).getByRole("button", { name: "News" })).toHaveAttribute("aria-current", "page");
});

test("Market Holidays opens from the menu and by deep link, in either market", async () => {
  window.history.replaceState(null, "", "/#holidays");
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} boardApi={{ name: "board" }} />);
  expect(await screen.findByRole("heading", { name: "Market Holidays page" })).toBeInTheDocument();
  expect((await openMenu()).getByRole("button", { name: "Market Holidays" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(within(screen.getByRole("dialog", { name: "Menu" })).getByRole("button", { name: "Tools" }));
  expect(await screen.findByRole("heading", { name: "Tools / board" })).toBeInTheDocument();
  fireEvent.click((await openMenu()).getByRole("button", { name: "Market Holidays" }));
  expect(await screen.findByRole("heading", { name: "Market Holidays page" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#holidays");
});

test("OI Analysis is reachable from both navigations and by deep link", async () => {
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} oiApi={{ name: "oi" }} />);
  fireEvent.click((await openMenu()).getByRole("button", { name: "OI Analysis" }));
  expect(await screen.findByRole("heading", { name: "OI Analysis / oi" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#oi-analysis");
  const mobile = within(screen.getByRole("navigation", { name: "Mobile section navigation" }));
  expect(mobile.getByRole("button", { name: "OI", exact: true })).toHaveAttribute("aria-current", "page");
});

test("Index Stocks opens from the menu and from a Home card with that index chosen", async () => {
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} indexStocksApi={{ name: "constituents" }} />);
  fireEvent.click(screen.getByRole("button", { name: "See SENSEX stocks" }));
  expect(await screen.findByRole("heading", { name: "Index Stocks / constituents" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#index-stocks");
  expect(localStorage.getItem("utraders-index-stocks")).toBe("sensex");
  expect(within(screen.getByRole("navigation", { name: "Mobile section navigation" })).getByRole("button", { name: "More pages" })).toHaveAttribute("aria-current", "page");
  expect((await openMenu()).getByRole("button", { name: "Index Stocks" })).toHaveAttribute("aria-current", "page");
});

test("the live Dashboard opens from the menu and by deep link", async () => {
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} dashboardApi={{ name: "charts" }} />);
  fireEvent.click((await openMenu()).getByRole("button", { name: "Dashboard" }));
  expect(await screen.findByRole("heading", { name: "Dashboard / charts" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#charts");
});

const chooseMarket = name => fireEvent.click(within(screen.getByRole("navigation", { name: "Market" })).getByRole("button", { name }));

test("the market switch at the top shows only commodity pages and remembers the choice", async () => {
  const commodityApi = { name: "mcx", decision: jest.fn(async () => ({})) };
  const { unmount } = render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} commodityApi={commodityApi} />);
  expect(screen.getByText("Market: india")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Index dashboard" })).toBeInTheDocument();
  chooseMarket("Commodity");
  expect(screen.getByText("Market: commodity")).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Commodity details / mcx" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Index dashboard" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "See SENSEX stocks" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load cards" }));
  expect(commodityApi.decision).toHaveBeenCalled();
  expect(localStorage.getItem("utraders-market")).toBe("commodity");
  // Only the pages that apply to commodities stay in the menu and on the phone bar.
  expect((await openMenu()).getAllByRole("button").map(item => item.getAttribute("aria-label"))).toEqual(["Home", "News", "Dashboard", "Tools", "Market Holidays", "My Trading", "Settings"]);
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Menu" }), { key: "Escape" });
  const phone = within(screen.getByRole("navigation", { name: "Mobile section navigation" }));
  expect(phone.getAllByRole("button").map(item => item.textContent)).toEqual(["Home", "Charts", "Tools", "Trading", "More"]);
  unmount();
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} commodityApi={commodityApi} />);
  expect(screen.getByText("Market: commodity")).toBeInTheDocument();
  chooseMarket("Indian market");
  expect(screen.getByRole("heading", { name: "Index dashboard" })).toBeInTheDocument();
  expect(localStorage.getItem("utraders-market")).toBe("india");
});

test("choosing Commodity on an Indian page goes Home, and an Indian link brings the Indian market back", async () => {
  window.history.replaceState(null, "", "/#oi-analysis");
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} oiApi={{ name: "oi" }} commodityApi={{ name: "mcx", decision: jest.fn() }} />);
  expect(await screen.findByRole("heading", { name: "OI Analysis / oi" })).toBeInTheDocument();
  chooseMarket("Commodity");
  expect(await screen.findByRole("heading", { name: "Commodity details / mcx" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#index");
  act(() => {
    window.history.replaceState(null, "", "/#equity");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(await screen.findByRole("heading", { name: "Equity / stocks" })).toBeInTheDocument();
  expect(within(screen.getByRole("navigation", { name: "Market" })).getByRole("button", { name: "Indian market" })).toHaveAttribute("aria-pressed", "true");
  expect(localStorage.getItem("utraders-market")).toBe("india");
});
