import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import MainPage from "./mainPage";

jest.mock("./dashboard", () => ({ __esModule: true, default: () => <h1>Index dashboard</h1> }));
jest.mock("./home", () => ({ __esModule: true, default: ({ details, onOpenStocks }) => <div>{details}<button onClick={() => onOpenStocks("sensex")}>See SENSEX stocks</button></div> }));
jest.mock("./indexStocks", () => ({ __esModule: true, default: ({ api }) => <h1>Index Stocks / {api.name}</h1> }));
jest.mock("./settings", () => ({ __esModule: true, default: () => <h1>Settings</h1> }));
jest.mock("./equity", () => ({ __esModule: true, default: ({ indexOptions, api }) => <h1>{indexOptions ? "Index Options" : "Equity"} / {api.name}</h1> }));
jest.mock("./oiAnalysis", () => ({ __esModule: true, default: ({ api }) => <h1>OI Analysis / {api.name}</h1> }));

afterEach(() => { window.history.replaceState(null, "", "/"); });

test("Index Options deep link and desktop navigation keep the APIs separate", async () => {
  window.history.replaceState(null, "", "/#index-options");
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} />);
  expect(await screen.findByRole("heading", { name: "Index Options / indices" })).toBeInTheDocument();
  const nav = within(screen.getByRole("navigation", { name: "Main navigation" }));
  expect(nav.getByRole("button", { name: "Index Options" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(nav.getByRole("button", { name: "Equity", exact: true }));
  expect(await screen.findByRole("heading", { name: "Equity / stocks" })).toBeInTheDocument();
  fireEvent.click(nav.getByRole("button", { name: "Home", exact: true }));
  expect(screen.getByRole("heading", { name: "Index dashboard" })).toBeInTheDocument();
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
  fireEvent.click(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "OI Analysis" }));
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
  expect(within(screen.getByRole("navigation", { name: "Main navigation" })).getByRole("button", { name: "Index Stocks" })).toHaveAttribute("aria-current", "page");
  expect(within(screen.getByRole("navigation", { name: "Mobile section navigation" })).getByRole("button", { name: "Stocks", exact: true })).toHaveAttribute("aria-current", "page");
});
