import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import Navbar from "./components/navbar";
import { THEME_KEY, ThemeProvider, useTheme } from "./theme";

const Probe = () => <span data-testid="mode">{useTheme().theme}</span>;
beforeEach(() => localStorage.clear());
afterEach(() => { delete document.documentElement.dataset.theme; });

test("light is the default and the top bar switches to dark mode and back", () => {
  render(<ThemeProvider><Navbar currentPage="equity" /><Probe /></ThemeProvider>);
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expect(screen.getByTestId("mode")).toHaveTextContent("light");
  fireEvent.click(screen.getByRole("button", { name: "Switch to dark mode" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(screen.getByTestId("mode")).toHaveTextContent("dark");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  fireEvent.click(screen.getByRole("button", { name: "Switch to light mode" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expect(localStorage.getItem(THEME_KEY)).toBe("light");
});

test("a saved dark choice is used on the next visit", () => {
  localStorage.setItem(THEME_KEY, "dark");
  render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(screen.getByTestId("mode")).toHaveTextContent("dark");
});
