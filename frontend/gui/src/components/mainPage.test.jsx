import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import MainPage from "./mainPage";

jest.mock("./dashboard", () => ({ __esModule: true, default: () => <h1>Index dashboard</h1> }));
jest.mock("./settings", () => ({ __esModule: true, default: () => <h1>Settings</h1> }));
jest.mock("./equity", () => ({ __esModule: true, default: ({ indexOptions, api }) => <h1>{indexOptions ? "Index Options" : "Equity"} / {api.name}</h1> }));

afterEach(() => { window.history.replaceState(null, "", "/"); });

test("Index Options deep link and desktop navigation keep the APIs separate", async () => {
  window.history.replaceState(null, "", "/#index-options");
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} />);
  expect(await screen.findByRole("heading", { name: "Index Options / indices" })).toBeInTheDocument();
  const nav = within(screen.getByRole("navigation", { name: "Main navigation" }));
  expect(nav.getByRole("button", { name: "Index Options" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(nav.getByRole("button", { name: "Equity", exact: true }));
  expect(await screen.findByRole("heading", { name: "Equity / stocks" })).toBeInTheDocument();
  fireEvent.click(nav.getByRole("button", { name: "Index", exact: true }));
  expect(screen.getByRole("heading", { name: "Index dashboard" })).toBeInTheDocument();
});

test("mobile navigation includes the separate Index Options section", async () => {
  render(<MainPage username="demo" equityApi={{ name: "stocks" }} indexOptionsApi={{ name: "indices" }} />);
  const nav = within(screen.getByRole("navigation", { name: "Mobile section navigation" }));
  expect(nav.getAllByRole("button")).toHaveLength(4);
  fireEvent.click(nav.getByRole("button", { name: "Index Options", exact: true }));
  expect(await screen.findByRole("heading", { name: "Index Options / indices" })).toBeInTheDocument();
  expect(window.location.hash).toBe("#index-options");
});
