import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import Navbar from "./components/navbar";
import { THEME_KEY, ThemeProvider } from "./theme";

const AppTheme = () => <ThemeProvider><Navbar currentPage="equity" /></ThemeProvider>;
beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.theme; });
afterEach(() => { jest.restoreAllMocks(); delete document.documentElement.dataset.theme; });

test("dark is the brand default and the accessible toggle persists both modes", () => {
  const view = render(<AppTheme />);
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expect(localStorage.getItem(THEME_KEY)).toBe("light");
  view.unmount();
  render(<AppTheme />);
  expect(screen.getByRole("button", { name: "Switch to dark mode" })).toHaveAttribute("title", "Switch to dark mode");
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");
});

test("invalid saved values fall back to dark", () => {
  localStorage.setItem(THEME_KEY, "invalid");
  render(<AppTheme />);
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
});

test("theme still changes when browser storage is unavailable", () => {
  jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  render(<AppTheme />);
  fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
});

test("theme synchronizes across tabs and ignores unrelated preferences", () => {
  render(<AppTheme />);
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY, newValue: "light" })); });
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "watchlist", newValue: "dark" })); });
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEY, newValue: null })); });
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
});
