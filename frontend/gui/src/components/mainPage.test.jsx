import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import MainPage from "./mainPage";

jest.mock("./dashboard", () => ({ __esModule: true, default: () => <h1>Index dashboard</h1> }));
jest.mock("./home", () => ({ __esModule: true, default: ({ details, onOpenStocks }) => <div>{details}<button onClick={() => onOpenStocks("sensex")}>See SENSEX stocks</button></div> }));
jest.mock("./indexStocks", () => ({ __esModule: true, default: ({ api }) => <h1>Index Stocks / {api.name}</h1> }));
jest.mock("./settings", () => ({ __esModule: true, default: () => <h1>Settings</h1> }));
jest.mock("./equity", () => ({ __esModule: true, default: ({ indexOptions, api }) => <h1>{indexOptions ? "Index Options" : "Equity"} / {api.name}</h1> }));
jest.mock("./oiAnalysis", () => ({ __esModule: true, default: ({ api }) => <h1>OI Analysis / {api.name}</h1> }));

afterEach(() => { window.history.replaceState(null, "", "/"); });

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
  expect(nav.getAllByRole("button").map(item => item.getAttribute("aria-label"))).toEqual(["Home", "Index Stocks", "Equity", "Index Options", "OI Analysis", "My Trading", "Settings"]);
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

test("mobile navigation includes the separate Index Options section", async () => {
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} />);
  const nav = within(screen.getByRole("navigation", { name: "Mobile section navigation" }));
  expect(nav.getAllByRole("button")).toHaveLength(7);
  fireEvent.click(nav.getByRole("button", { name: "Options", exact: true }));
  expect(await screen.findByRole("heading", { name: "Index Options / indices" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#index-options");
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
  expect(within(screen.getByRole("navigation", { name: "Mobile section navigation" })).getByRole("button", { name: "Stocks", exact: true })).toHaveAttribute("aria-current", "page");
  expect((await openMenu()).getByRole("button", { name: "Index Stocks" })).toHaveAttribute("aria-current", "page");
});
